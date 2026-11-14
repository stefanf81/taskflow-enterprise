import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  isDevMode,
  signal,
  untracked,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, required } from '@angular/forms/signals';
import { appointmentCreateSchema } from '@taskflow/schemas';
import { NO_PREFERENCE_BARBER, closedDaysMessage, isWithinBookingWindow } from '@taskflow/domain';
import { AppointmentItem } from '../../types/api';
import {
  DEFAULT_TIME_SLOTS,
  type WallClock,
  computeEstimatedEndTime,
  isSlotInPast,
  msUntilNextMidnight,
  toLocalDateString,
} from '../../core/time-utils';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { formatUsd } from '../../core/format';
import { AuthState } from '../../core/auth/auth.state';
import { ServiceCatalogStore } from '../../core/catalog/service-catalog.store';
import { CustomerStore } from '../../core/customer/customer.store';
import { isServerRender } from '../../core/platform';
import { refreshResource, safeResourceValue } from '../../core/resource-utils';
import { ReviewStore } from '../../core/reviews/review.store';
import { SessionEvents } from '../../core/session-events';
import { ShopClock } from '../../core/shop-clock';
import { FlashMessages } from '../../core/ui/flash-messages';
import * as calendar from './booking-calendar';
import { LookbookSelectionBus } from './lookbook-selection';
import { PublicBarberStore } from './public-barber.store';
import { toStylistProfiles } from './stylist-card/stylist-profiles';

/** Model shape for the Signal Forms booking wizard. */
export interface BookingFormModel {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  barberName: string;
  bookingDate: string;
  bookingTime: string;
  serviceType: string;
}

/** Steps of the booking wizard, in order (1-based in the store and the template). */
export const WIZARD_STEPS = [
  'Select Treatment',
  'Choose Your Stylist',
  'Pick Date & Available Slot',
  'Customer Info & Submit',
] as const;

const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

/**
 * The "No Preference" choice. It is sent as the barber name; the server resolves it to a real
 * barber (for availability: across all barbers; for a booking: inside the booking transaction).
 */
export const NO_PREFERENCE_LABEL = NO_PREFERENCE_BARBER;

const NO_CONTACT = { customerName: '', customerEmail: '', customerPhone: '' };

/**
 * Guest booking wizard state machine.
 *
 * Owns the Signal Form model, the 4-step navigation, slot availability (an `httpResource` keyed
 * on barber, date and service) and submission, so the step components stay presentational. The
 * calendar rules are pure functions in `booking-calendar.ts`; banner messages go to the app-wide
 * `FlashMessages`.
 */
@Injectable({ providedIn: 'root' })
export class BookingStore {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly publicBarberStore = inject(PublicBarberStore);
  private readonly reviewStore = inject(ReviewStore);
  private readonly authState = inject(AuthState);
  private readonly customerStore = inject(CustomerStore);
  private readonly sessionEvents = inject(SessionEvents);
  private readonly shopClock = inject(ShopClock);
  private readonly flash = inject(FlashMessages);
  private readonly lookbookSelection = inject(LookbookSelectionBus);
  private readonly destroyRef = inject(DestroyRef);
  // Build-time prerendering has no backend (the wizard is prerendered on `/`).
  private readonly prerendering = isServerRender();

  readonly noPreferenceLabel = NO_PREFERENCE_LABEL;
  readonly timeSlots = DEFAULT_TIME_SLOTS;
  readonly services = this.catalogStore.services;

  // Load failures of the data the wizard depends on (the lists themselves are error-safe
  // and simply empty), so steps 1 and 2 can say "could not load" with a retry instead of
  // rendering an unexplained blank list.
  readonly catalogError = this.catalogStore.errorMessage;
  readonly catalogLoaded = this.catalogStore.hasLoaded;
  readonly rosterLoading = this.publicBarberStore.isLoading;
  readonly rosterError = this.publicBarberStore.errorMessage;

  // Booking form model + validation (Angular 22 Signal Forms).
  readonly bookingModel = signal<BookingFormModel>({
    ...NO_CONTACT,
    barberName: NO_PREFERENCE_LABEL,
    bookingDate: '',
    bookingTime: '09:00',
    // Chosen from the catalog (see the constructor): a hard-coded name would break the
    // wizard as soon as that service is retired or renamed.
    serviceType: '',
  });

  readonly bookingForm = form(this.bookingModel, (f) => {
    required(f.customerName);
    required(f.customerEmail);
    required(f.customerPhone);
    required(f.bookingDate);
    required(f.bookingTime);
  });

  // Per-field views of the model. The availability lookup is keyed on them, so typing a contact
  // detail (a new model object) never restarts it: these only change when the value does.
  readonly bookingBarber = computed(() => this.bookingModel().barberName);
  readonly bookingDate = computed(() => this.bookingModel().bookingDate);
  readonly bookingTime = computed(() => this.bookingModel().bookingTime);
  readonly bookingService = computed(() => this.bookingModel().serviceType);

  // Wizard navigation, catalog browsing and submission state.
  readonly activeStep = signal<number>(1);
  readonly selectedCategory = signal<string>('all');
  readonly serviceSearchQuery = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);
  readonly showReceiptModal = signal<boolean>(false);
  readonly lastBookedAppointment = signal<AppointmentItem | null>(null);
  /**
   * Price of the booking behind the open receipt, captured at SUBMIT time. The
   * live `checkoutTotal` cannot be used for the receipt: the form is reset the
   * moment the booking succeeds, which flips the selected service back to the
   * catalog's first entry (and with it the displayed price).
   */
  readonly lastBookedTotal = signal<number>(0);

  /**
   * "Now" on the shop's wall clock (its time zone, as the server judges bookings; the visitor's
   * own clock until the zone is known). A signal — not a bare
   * `new Date()` inside a computed — so the date carousel and the slot grid move
   * on when the wizard is re-entered, the tab becomes visible again, or local
   * midnight passes. See {@link watchToday} / {@link refreshToday}.
   */
  readonly now = signal<WallClock>(this.shopClock.now());
  readonly today = computed(() => toLocalDateString(this.now()));
  /** Booking window and opening days, from the backend (`ShopClock`). */
  readonly shopRules = this.shopClock.rules;
  readonly upcomingBookingDays = computed(() =>
    calendar.upcomingBookingDays(this.now(), this.timeSlots, this.shopRules()),
  );

  /** Read by the availability request so a retry can restart a lookup already in flight. */
  private readonly slotsRefreshTick = signal(0);

  /**
   * Slots of the selected barber and date that cannot be booked for the selected service.
   * Changing any of the three cancels the lookup in flight and starts a new one, so a slow
   * answer for an earlier date can never land on the current one (B4).
   */
  private readonly busySlotsResource = httpResource<string[]>(
    () => {
      const barberName = this.bookingBarber();
      const bookingDate = this.bookingDate();
      // Nothing to look up yet, a closed day (never selectable), or the backend-less prerender.
      if (
        this.prerendering ||
        !barberName ||
        !bookingDate ||
        calendar.isClosedDay(bookingDate, this.shopRules())
      ) {
        return undefined;
      }
      this.slotsRefreshTick();
      return this.appointmentsApi.busySlotsRequest(
        barberName,
        bookingDate,
        this.bookingService() || undefined,
      );
    },
    { defaultValue: [], parse: this.appointmentsApi.parseBusySlots },
  );

  /** Error-safe: empty while there is no answer for the current selection. */
  readonly busySlots = safeResourceValue(this.busySlotsResource, []);
  readonly isCheckingSlots = this.busySlotsResource.isLoading;
  /**
   * Set when the busy-slot lookup failed: availability is UNKNOWN, not "all free" (step 3 stays
   * blocked; the grid offers a retry). Null again while a retry runs.
   */
  readonly slotsError = computed(() => {
    if (this.busySlotsResource.isLoading()) return null;
    const err = this.busySlotsResource.error();
    return err ? extractApiError(err, 'Could not check availability. Please try again.') : null;
  });

  /** Email problem to show next to the field, or null when it is acceptable. */
  readonly emailError = computed(() => {
    const email = this.bookingModel().customerEmail.trim();
    if (!email) return 'Valid email address is required.';
    const result = appointmentCreateSchema.shape.customerEmail.safeParse(email);
    return result.success ? null : (result.error.issues[0]?.message ?? 'Invalid email format');
  });

  // Step 4 field messages only appear once a field was touched (blurred) or a submit was
  // attempted, so a freshly opened form does not fire a burst of role="alert" errors.
  readonly nameError = computed(() =>
    this.bookingForm.customerName().touched() && !this.bookingModel().customerName.trim()
      ? 'Full name is required.'
      : null,
  );
  readonly visibleEmailError = computed(() =>
    this.bookingForm.customerEmail().touched() ? this.emailError() : null,
  );
  readonly phoneError = computed(() =>
    this.bookingForm.customerPhone().touched() && !this.bookingModel().customerPhone.trim()
      ? 'Phone number is required.'
      : null,
  );

  // Stylist Profiles: API-driven roster (PublicBarberStore) joined with ratings.
  readonly stylistProfiles = computed(() =>
    toStylistProfiles(
      this.publicBarberStore.barbers(),
      this.reviewStore.ratings(),
      this.reviewStore.status(),
    ),
  );

  readonly filteredServices = computed(() => {
    const cat = this.selectedCategory();
    const query = this.serviceSearchQuery().trim().toLowerCase();

    let list = this.services();
    if (cat !== 'all') {
      list = list.filter((s) => s.category === cat);
    }
    if (query) {
      list = list.filter(
        (s) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query),
      );
    }
    return list;
  });

  readonly selectedServiceObj = computed(() =>
    this.services().find((s) => s.name === this.bookingService()),
  );

  readonly estimatedEndTime = computed(() => {
    const svc = this.selectedServiceObj();
    const time = this.bookingTime();
    if (!svc || !time) return '';
    return computeEstimatedEndTime(time, svc.durationMinutes);
  });

  // Booking price summary. The backend does not model a platform fee, so the
  // receipt and the wizard summary show the catalog service price only.
  readonly checkoutTotal = computed(() => this.selectedServiceObj()?.price ?? 0);

  readonly formattedTotal = computed(() => formatUsd(this.checkoutTotal()));

  /**
   * Idempotency key for the current logical booking attempt. Generated on the
   * first submit (or when the payload changes) and retained across failures so
   * an ambiguous timeout + re-tap replays the original booking instead of
   * creating a second one. Cleared on success and on a 409 conflict.
   */
  private idempotencyKey: string | null = null;
  private idempotencyFingerprint: string | null = null;

  /** Contact details of the signed-in customer, re-applied whenever the form resets. */
  private sessionContact = NO_CONTACT;
  /** Re-arms {@link watchToday}'s midnight timer once `/public/shop` delivers the shop's zone. */
  private rearmMidnight: (() => void) | null = null;

  constructor() {
    // The lookbook lives on the landing page, which no longer imports this store (that static
    // import pulled Signal Forms and the wizard into the eager main.js). The bus holds the pick
    // in a signal, so one made before the wizard hydrated is applied here on construction.
    let lastLookbookSeq = 0;
    effect(() => {
      const pick = this.lookbookSelection.pick();
      if (!pick || pick.seq === lastLookbookSeq) return;
      // The wizard can now hydrate before the catalog has answered, and selectLookbookStyle
      // validates the style against it. Wait for the request to settle rather than reject a
      // style that is about to become valid; a failed catalog still reports "not available".
      if (this.catalogStore.isLoading()) return;
      lastLookbookSeq = pick.seq;
      untracked(() => this.selectLookbookStyle(pick.serviceName, pick.category));
    });

    // The shop's zone arrives after the first render: re-read "now" in it and re-arm midnight.
    effect(() => {
      this.shopClock.timeZone();
      untracked(() => {
        this.refreshToday();
        this.rearmMidnight?.();
      });
    });

    // Keep the selection on a service the catalog really offers: preselect the first one
    // once the catalog loads, and fall back to it if the selected service was retired.
    effect(() => {
      const services = this.services();
      untracked(() => {
        const first = services[0];
        if (first && !services.some((s) => s.name === this.bookingService())) {
          this.bookingModel.update((m) => ({ ...m, serviceType: first.name }));
        }
      });
    });

    // Nothing of a guest or finished session may linger across sign-out on a shared device:
    // contact details, receipt (carries the customer's name and code), search and form.
    this.sessionEvents.sessionEnded.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.clearPersonalState();
      this.resetBookingForm();
    });

    // Signing in drops the same personal leftovers, but NOT the booking being made: a guest who
    // picks a service, a stylist and a slot and then signs in to book it under their account
    // keeps all of it and stays on their step (none of it is anyone's personal data). Only the
    // typed-in contact details go, so the previous visitor's name and e-mail cannot be submitted
    // by whoever just signed in; the portal re-fills them from the new session.
    this.sessionEvents.sessionStarted.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.clearPersonalState();
      this.serviceSearchQuery.set('');
      this.bookingModel.update((m) => ({ ...m, ...NO_CONTACT }));
      // The emptied contact fields must not show "required" errors before they are touched.
      this.bookingForm().reset();
    });
  }

  /** Drops what belongs to the visitor who was here before: remembered contact details, receipt. */
  private clearPersonalState(): void {
    this.sessionContact = NO_CONTACT;
    this.showReceiptModal.set(false);
    this.lastBookedAppointment.set(null);
    this.lastBookedTotal.set(0);
  }

  retryCatalog(): void {
    this.catalogStore.loadServices();
  }

  retryRoster(): void {
    this.publicBarberStore.loadBarbers();
  }

  /** Re-checks availability (the grid's Retry button); restarts a lookup already in flight. */
  retrySlots(): void {
    refreshResource(this.busySlotsResource, this.slotsRefreshTick);
  }

  setServiceCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  // A different service, stylist or date re-keys the availability lookup by itself (a longer
  // service may not fit where a shorter one does).
  selectService(name: string): void {
    this.bookingModel.update((m) => ({ ...m, serviceType: name }));
  }

  selectStylist(name: string): void {
    this.bookingModel.update((m) => ({ ...m, barberName: name }));
  }

  selectLookbookStyle(serviceName: string, category: string): void {
    // The lookbook names its styles itself; only a service the catalog offers can be booked.
    if (!this.services().some((s) => s.name === serviceName)) {
      this.flash.errorMessage.set(
        `${serviceName} is not available right now. Please choose a service from the list.`,
      );
      return;
    }
    this.bookingModel.update((m) => ({ ...m, serviceType: serviceName }));
    this.selectedCategory.set(category);
    this.activeStep.set(2);
    this.flash.showSuccess(`✨ Lookbook Style selected: ${serviceName}! Choose your stylist next.`);
  }

  isStepValid(step: number): boolean {
    const m = this.bookingModel();
    if (step === 1) {
      return this.services().some((s) => s.name === m.serviceType);
    }
    if (step === 2) {
      return !!m.barberName;
    }
    if (step === 3) {
      return (
        !!m.bookingDate &&
        !!m.bookingTime &&
        isWithinBookingWindow(m.bookingDate, this.now(), this.shopRules()) &&
        !calendar.isClosedDay(m.bookingDate, this.shopRules()) &&
        !this.isSlotUnavailable(m.bookingTime) &&
        // Never validate against a stale or missing availability answer: while a lookup is
        // running there is no answer for this selection yet, and after a failed lookup
        // availability is unknown (the backend refuses conservatively too).
        !this.isCheckingSlots() &&
        !this.slotsError()
      );
    }
    if (step === 4) {
      return !!m.customerName.trim() && !this.emailError() && !!m.customerPhone.trim();
    }
    return false;
  }

  /** A slot of the selected date that cannot be chosen: taken, or already started today. */
  isSlotUnavailable(slot: string): boolean {
    return calendar.isSlotUnavailable(this.bookingDate(), slot, this.now(), this.busySlots());
  }

  /** Whether `slot` on the selected date has already started (on the shop's wall clock). */
  isSlotPast(slot: string): boolean {
    return isSlotInPast(this.bookingDate(), slot, this.now());
  }

  /**
   * Re-reads the clock. Called on wizard entry, when the tab becomes visible again,
   * at local midnight, and when a date is picked. Drops a selection the new "now"
   * has invalidated (a date that passed, a same-day time that started).
   */
  refreshToday(): void {
    this.now.set(this.shopClock.now());
    this.revalidateSelection();
  }

  /**
   * Keeps "today" fresh for as long as `owner` lives: refreshes immediately, then on
   * `visibilitychange` and at every local midnight. The listener and timer are torn
   * down with `owner` (the wizard component), never leaked past it.
   */
  watchToday(owner: DestroyRef): void {
    this.refreshToday();
    if (typeof document === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') this.refreshToday();
    };
    document.addEventListener('visibilitychange', onVisible);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer);
      // +1s so the refresh lands safely after midnight even with timer drift.
      timer = setTimeout(
        () => {
          this.refreshToday();
          arm();
        },
        msUntilNextMidnight(this.shopClock.timeZone()) + 1000,
      );
    };
    this.rearmMidnight = arm;
    arm();

    owner.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) clearTimeout(timer);
      if (this.rearmMidnight === arm) this.rearmMidnight = null;
    });
  }

  private revalidateSelection(): void {
    const m = this.bookingModel();
    const now = this.now();
    if (m.bookingDate && !isWithinBookingWindow(m.bookingDate, now, this.shopRules())) {
      // Clearing the date also drops its availability lookup (the resource goes idle).
      this.bookingModel.update((model) => ({ ...model, bookingDate: '' }));
      this.flash.errorMessage.set(
        'The date you selected is no longer available. Please pick a new date.',
      );
      return;
    }
    if (m.bookingDate && isSlotInPast(m.bookingDate, m.bookingTime, now)) {
      this.bookingModel.update((model) => ({
        ...model,
        bookingTime: this.firstOpenSlot(model.bookingDate),
      }));
    }
  }

  private firstOpenSlot(date: string): string {
    return calendar.firstOpenSlot(date, this.now(), this.timeSlots, this.busySlots());
  }

  /**
   * Whether the stepper may jump to `step`: any step already passed, or a later one whose
   * preceding steps are ALL valid (the wizard is gated; skipping an invalid step is not
   * allowed). Unreachable steps stay focusable in the tablist but are `aria-disabled`.
   */
  isStepReachable(step: number): boolean {
    if (step < 1 || step > WIZARD_STEP_COUNT) return false;
    if (step <= this.activeStep()) return true;
    for (let previous = 1; previous < step; previous++) {
      if (!this.isStepValid(previous)) return false;
    }
    return true;
  }

  setStep(step: number): void {
    if (this.isStepReachable(step)) {
      this.activeStep.set(step);
    }
  }

  goToNextStep(): void {
    if (this.isStepValid(this.activeStep())) {
      this.activeStep.update((s) => s + 1);
      if (this.activeStep() === 3) {
        // Coming back to the grid: ask again rather than show an old answer. A no-op without a
        // date or while a lookup is already running.
        this.busySlotsResource.reload();
      }
    }
  }

  goToPrevStep(): void {
    if (this.activeStep() > 1) {
      this.activeStep.update((s) => s - 1);
    }
  }

  selectBookingDate(dateStr: string): void {
    this.refreshToday();
    const rules = this.shopRules();
    if (!isWithinBookingWindow(dateStr, this.now(), rules)) {
      this.flash.errorMessage.set(
        `Please pick a date from today up to ${rules.maxAdvanceDays} days ahead.`,
      );
      return;
    }
    if (calendar.isClosedDay(dateStr, rules)) {
      this.flash.errorMessage.set(
        `${closedDaysMessage(rules) ?? 'We are closed that day.'} Please pick another day.`,
      );
      this.bookingModel.update((m) => ({ ...m, bookingDate: '' }));
      return;
    }
    this.bookingModel.update((m) => ({ ...m, bookingDate: dateStr }));
    // The preselected default time may already be over on the chosen day (today).
    if (isSlotInPast(dateStr, this.bookingTime(), this.now())) {
      this.bookingModel.update((m) => ({ ...m, bookingTime: this.firstOpenSlot(dateStr) }));
    }
  }

  selectTimeSlot(slot: string): void {
    if (!this.isSlotUnavailable(slot)) {
      this.bookingModel.update((m) => ({ ...m, bookingTime: slot }));
    }
  }

  /** Marks the contact fields touched, so every one of their messages shows. */
  revealContactErrors(): void {
    this.bookingForm.customerName().markAsTouched();
    this.bookingForm.customerEmail().markAsTouched();
    this.bookingForm.customerPhone().markAsTouched();
  }

  // Submit Guest Booking (Client Calendar Interface)
  submitBooking(): void {
    // A submit attempt reveals the message of every contact field, touched or not.
    this.revealContactErrors();
    // Time may have moved on while the form was open (tab left idle past the slot, or
    // past midnight): re-read the clock first so the checks below use a fresh selection.
    const chosenTime = this.bookingTime();
    this.refreshToday();
    const model = this.bookingModel();
    const name = model.customerName.trim();
    const email = model.customerEmail.trim();
    const phone = model.customerPhone.trim();
    const errorMessage = this.flash.errorMessage;

    if (!model.bookingDate) {
      // The chosen date is gone (refreshToday() said why) or never picked: back to step 3.
      errorMessage.set(errorMessage() ?? 'Please pick a date and time to secure your slot.');
      this.activeStep.set(3);
      return;
    }

    if (!name || !email || !phone) {
      errorMessage.set('Please fill out all required fields to secure your slot.');
      return;
    }

    // Catch an address the server would reject BEFORE the round trip ("a@b").
    const emailProblem = this.emailError();
    if (emailProblem) {
      errorMessage.set(emailProblem);
      return;
    }

    if (model.bookingTime !== chosenTime) {
      // The slot started while the form sat open and refreshToday() moved the selection:
      // never submit a time the customer did not pick.
      errorMessage.set('That time has already passed. Please pick a later slot.');
      this.activeStep.set(3);
      return;
    }

    if (this.isCheckingSlots() || this.slotsError()) {
      errorMessage.set(
        this.slotsError() ?? 'Still checking availability. Please try again in a moment.',
      );
      return;
    }

    // The slot may have been taken by another guest since the last availability
    // check — refuse the stale slot and refresh the grid instead of submitting
    // blindly (B4).
    if (this.busySlots().includes(model.bookingTime)) {
      errorMessage.set('That time slot was just taken. Please pick another slot.');
      this.retrySlots();
      return;
    }

    this.isSubmitting.set(true);
    errorMessage.set(null);
    // What the customer is shown and agrees to NOW; the receipt must not re-derive it later.
    const bookedTotal = this.checkoutTotal();

    const payload = {
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      barberName: model.barberName,
      bookingDate: model.bookingDate,
      bookingTime: model.bookingTime,
      serviceType: model.serviceType,
    };

    // Reuse the key only while the payload is byte-for-byte identical, so an
    // edited booking (different slot, service, or contact details) is treated
    // as a new request rather than replayed against the old one.
    const fingerprint = JSON.stringify(payload);
    if (this.idempotencyKey === null || this.idempotencyFingerprint !== fingerprint) {
      this.idempotencyKey = crypto.randomUUID();
      this.idempotencyFingerprint = fingerprint;
    }

    this.appointmentsApi
      .createAppointment(payload, this.idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.isSubmitting.set(false);
          this.lastBookedAppointment.set(created);
          this.lastBookedTotal.set(bookedTotal);
          this.showReceiptModal.set(true);
          this.resetBookingForm();
          // A signed-in customer's portal list must show the new booking.
          if (this.authState.isLoggedIn()) {
            this.customerStore.loadAppointments();
          }
        },
        error: (err) => {
          // A 409 means this key was already used for a different payload; the
          // next attempt must use a fresh key.
          if (err?.status === 409) {
            this.idempotencyKey = null;
            this.idempotencyFingerprint = null;
          }
          // Verbose error logging only in dev builds to avoid leaking backend
          // error details (validation field names, partial payloads) into the
          // production browser console.
          if (isDevMode()) {
            console.error(
              'CREATE APPT ERROR STATUS:',
              err.status,
              'MESSAGE:',
              err.message,
              'BODY:',
              err.error,
            );
          }
          errorMessage.set(extractApiError(err, 'Failed to submit booking request.'));
          this.isSubmitting.set(false);
        },
      });
  }

  /** Back to step 1 with an empty selection (the signed-in customer's contact stays). */
  resetBookingForm(): void {
    const defaultService = this.services()[0]?.name ?? '';
    // An empty date also drops any availability lookup in flight.
    this.bookingModel.set({
      ...this.sessionContact,
      barberName: NO_PREFERENCE_LABEL,
      bookingDate: '',
      bookingTime: this.timeSlots[0] ?? '',
      serviceType: defaultService,
    });
    this.selectedCategory.set('all');
    this.serviceSearchQuery.set('');
    this.activeStep.set(1);
    // A fresh booking must not open step 4 with "required" errors from the last one.
    this.bookingForm().reset();
    this.isSubmitting.set(false);
    this.idempotencyKey = null;
    this.idempotencyFingerprint = null;
  }

  /**
   * Pre-fills the contact fields for a signed-in customer booking from the portal:
   * the email from the session principal (customers sign in with their email) and
   * name/phone from their most recent booking when one is loaded. Only EMPTY fields
   * are filled, so anything the customer typed or edited is never overwritten; all
   * three stay editable. No new backend endpoint is involved.
   */
  prefillFromSession(): void {
    const username = this.authState.username();
    const latest = this.customerStore.appointments()[0];
    this.sessionContact = {
      customerName: latest?.customerName ?? '',
      customerEmail: username.includes('@') ? username : (latest?.customerEmail ?? ''),
      customerPhone: latest?.customerPhone ?? '',
    };
    const contact = this.sessionContact;
    this.bookingModel.update((m) => ({
      ...m,
      customerName: m.customerName || contact.customerName,
      customerEmail: m.customerEmail || contact.customerEmail,
      customerPhone: m.customerPhone || contact.customerPhone,
    }));
  }
}
