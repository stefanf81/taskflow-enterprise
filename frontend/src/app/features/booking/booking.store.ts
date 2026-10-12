import { Injectable, signal, computed, inject, DestroyRef, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, required } from '@angular/forms/signals';
import { appointmentCreateSchema } from '@taskflow/schemas';
import { AppointmentItem } from '../../types/api';
import {
  DEFAULT_TIME_SLOTS,
  MAX_BOOKING_DAYS_AHEAD,
  computeEstimatedEndTime,
  isBookableDate,
  isSlotInPast,
  msUntilNextLocalMidnight,
  toLocalDateString,
} from '../../time-utils';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { SessionEvents } from '../../core/session-events';
import { AppointmentStore } from '../../appointment.store';
import { AuthState } from '../../auth.state';
import { CustomerStore } from '../../customer.store';
import { ServiceCatalogStore } from '../../service-catalog.store';
import { PublicBarberStore } from '../../public-barber.store';
import { ReviewStore } from '../../review.store';

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
 * Optional display metadata for seeded barbers (role copy and badges).
 *
 * The roster itself comes from the API (PublicBarberStore) — this map only
 * decorates known display names and falls back to neutral copy for any other
 * barber, so adding/removing barbers never requires a code change.
 */
const BARBER_PRESENTATION: Record<string, { title: string; specialty: string; badge?: string }> = {
  'Alex the Barber': {
    title: 'Master Stylist',
    specialty: 'Classic Scissor Cuts',
    badge: 'Top Rated',
  },
  'Sara the Stylist': {
    title: 'Skin Fade Expert',
    specialty: 'Skin Fades & Tapers',
    badge: 'Featured',
  },
  'Marcus Master Blade': {
    title: 'Director Barber',
    specialty: 'Razor Shaves & Beards',
    badge: 'Master Barber',
  },
};

/**
 * Guest booking wizard state machine.
 *
 * Owns the Signal Form model, the 4-step navigation, slot availability lookup
 * (with stale-response protection) and submission, so the landing page and
 * wizard template stay presentational. Loading/alert state is shared through
 * `AppointmentStore`.
 */
@Injectable({ providedIn: 'root' })
export class BookingStore {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly appointmentStore = inject(AppointmentStore);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly publicBarberStore = inject(PublicBarberStore);
  private readonly reviewStore = inject(ReviewStore);
  private readonly authState = inject(AuthState);
  private readonly customerStore = inject(CustomerStore);
  private readonly sessionEvents = inject(SessionEvents);
  private readonly destroyRef = inject(DestroyRef);

  readonly noPreferenceLabel = 'No Preference (First Available)';
  readonly timeSlots = DEFAULT_TIME_SLOTS;
  readonly services = this.catalogStore.services;

  // Load failures of the data the wizard depends on (the lists themselves are error-safe
  // and simply empty), so steps 1 and 2 can say "could not load" with a retry instead of
  // rendering an unexplained blank list.
  readonly catalogError = this.catalogStore.errorMessage;
  readonly rosterError = this.publicBarberStore.errorMessage;

  // Shared loading / alert state (single source: AppointmentStore).
  readonly errorMessage = this.appointmentStore.errorMessage;
  readonly successMessage = this.appointmentStore.successMessage;
  readonly isSubmitting = this.appointmentStore.isSubmitting;
  readonly isCheckingSlots = this.appointmentStore.isCheckingSlots;
  readonly busySlots = this.appointmentStore.busySlots;

  // Booking form model + validation (Angular 22 Signal Forms).
  readonly bookingModel = signal<BookingFormModel>({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    barberName: this.noPreferenceLabel,
    bookingDate: '',
    bookingTime: '09:00',
    serviceType: 'Classic Haircut',
  });

  readonly bookingForm = form(this.bookingModel, (f) => {
    required(f.customerName);
    required(f.customerEmail);
    required(f.customerPhone);
    required(f.bookingDate);
    required(f.bookingTime);
  });

  // Convenience computed signals for template display.
  readonly bookingName = computed(() => this.bookingModel().customerName);
  readonly bookingEmail = computed(() => this.bookingModel().customerEmail);
  readonly bookingPhone = computed(() => this.bookingModel().customerPhone);
  readonly bookingBarber = computed(() => this.bookingModel().barberName);
  readonly bookingDate = computed(() => this.bookingModel().bookingDate);
  readonly bookingTime = computed(() => this.bookingModel().bookingTime);
  readonly bookingService = computed(() => this.bookingModel().serviceType);

  // Wizard navigation & catalog browsing state.
  readonly activeStep = signal<number>(1);
  readonly selectedCategory = signal<string>('all');
  readonly serviceSearchQuery = signal<string>('');
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
   * "Now" as the browser sees it (the shop's local time). A signal — not a bare
   * `new Date()` inside a computed — so the date carousel and the slot grid move
   * on when the wizard is re-entered, the tab becomes visible again, or local
   * midnight passes. See {@link watchToday} / {@link refreshToday}.
   */
  readonly now = signal<Date>(new Date());
  readonly today = computed(() => toLocalDateString(this.now()));

  /** Set when the busy-slot lookup failed: availability is UNKNOWN, not "all free". */
  readonly slotsError = signal<string | null>(null);

  /** Email problem to show next to the field, or null when it is acceptable. */
  readonly emailError = computed(() => {
    const email = this.bookingModel().customerEmail.trim();
    if (!email) return 'Valid email address is required.';
    const result = appointmentCreateSchema.shape.customerEmail.safeParse(email);
    return result.success ? null : (result.error.issues[0]?.message ?? 'Invalid email format');
  });

  // Stylist Profiles: API-driven roster (PublicBarberStore) joined with ratings.
  readonly stylistProfiles = computed(() => {
    const ratings = this.reviewStore.ratings();
    return this.publicBarberStore.barbers().map((barber) => {
      const presentation = BARBER_PRESENTATION[barber.name];
      const dbRating = ratings.find((r) => r.barberName === barber.name);
      return {
        name: barber.name,
        title: presentation?.title ?? 'Professional Barber',
        specialty: presentation?.specialty ?? 'All grooming services',
        ...(presentation?.badge ? { badge: presentation.badge } : {}),
        rating: dbRating ? `${dbRating.averageRating.toFixed(1)} ★` : '5.0 ★',
        reviews: dbRating ? `${dbRating.reviewCount} reviews` : 'New',
      };
    });
  });

  readonly upcomingBookingDays = computed(() => {
    const days = [];
    const today = this.now();

    let count = 0;
    let offset = 0;
    while (count < 7 && offset < Math.min(14, MAX_BOOKING_DAYS_AHEAD)) {
      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + offset);

      const dayOfWeek = nextDate.getDay();
      // Skip Sundays (closed) and a today with no slot left to book.
      const todayIsOver =
        offset === 0 &&
        this.timeSlots.every((slot) => isSlotInPast(toLocalDateString(today), slot, today));
      if (dayOfWeek !== 0 && !todayIsOver) {
        // Use local date components to avoid the UTC shift `toISOString()`
        // would introduce in US/EU timezones.
        days.push({
          dateStr: toLocalDateString(nextDate),
          dayName: nextDate.toLocaleDateString('en-US', { weekday: 'short' }),
          dayNum: nextDate.getDate(),
          monthName: nextDate.toLocaleDateString('en-US', { month: 'short' }),
        });
        count++;
      }
      offset++;
    }
    return days;
  });

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
    this.services().find((s) => s.name === this.bookingModel().serviceType),
  );

  readonly estimatedEndTime = computed(() => {
    const svc = this.selectedServiceObj();
    const time = this.bookingModel().bookingTime;
    if (!svc || !time) return '';
    return computeEstimatedEndTime(time, svc.durationMinutes);
  });

  // Booking price summary. The backend does not model a platform fee, so the
  // receipt and the wizard summary show the catalog service price only.
  readonly checkoutTotal = computed(() => this.selectedServiceObj()?.price ?? 0);

  readonly formattedTotal = computed(() => `$${this.checkoutTotal().toFixed(2)}`);

  readonly formattedBookingDate = computed(() => {
    const d = this.bookingDate();
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  /**
   * Monotonic sequence for busy-slot lookups. Responses are ignored unless they
   * belong to the latest request, so a slow response for an earlier date can
   * never overwrite the slots of the currently selected date (B4).
   */
  private busySlotsRequestSeq = 0;

  /**
   * Idempotency key for the current logical booking attempt. Generated on the
   * first submit (or when the payload changes) and retained across failures so
   * an ambiguous timeout + re-tap replays the original booking instead of
   * creating a second one. Cleared on success and on a 409 conflict.
   */
  private idempotencyKey: string | null = null;
  private idempotencyFingerprint: string | null = null;

  /** Contact details of the signed-in customer, re-applied whenever the form resets. */
  private sessionContact = { customerName: '', customerEmail: '', customerPhone: '' };

  constructor() {
    // Nothing of a finished session may linger for the next visitor on a shared device:
    // the contact details, the receipt (it carries the customer's name and code) and the form.
    this.sessionEvents.sessionEnded.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.sessionContact = { customerName: '', customerEmail: '', customerPhone: '' };
      this.showReceiptModal.set(false);
      this.lastBookedAppointment.set(null);
      this.lastBookedTotal.set(0);
      this.resetBookingForm();
    });
  }

  retryCatalog(): void {
    this.catalogStore.loadServices();
  }

  retryRoster(): void {
    this.publicBarberStore.loadBarbers();
  }

  onSearchChange(value: string): void {
    this.serviceSearchQuery.set(value);
  }

  setServiceCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  selectService(name: string): void {
    this.bookingModel.update((m) => ({ ...m, serviceType: name }));
    // Availability depends on the service's length: refresh it if a slot grid is showing.
    if (this.bookingBarber() && this.bookingDate()) this.onBarberOrDateChange();
  }

  selectStylist(name: string): void {
    this.bookingModel.update((m) => ({ ...m, barberName: name }));
    this.onBarberOrDateChange();
  }

  selectLookbookStyle(serviceName: string, category: string): void {
    this.bookingModel.update((m) => ({ ...m, serviceType: serviceName }));
    this.selectedCategory.set(category);
    this.activeStep.set(2);
    this.appointmentStore.showSuccess(
      `✨ Lookbook Style selected: ${serviceName}! Choose your stylist next.`,
    );
  }

  isStepValid(step: number): boolean {
    const m = this.bookingModel();
    if (step === 1) {
      return !!m.serviceType;
    }
    if (step === 2) {
      return !!m.barberName;
    }
    if (step === 3) {
      return (
        !!m.bookingDate &&
        !!m.bookingTime &&
        isBookableDate(m.bookingDate, this.now()) &&
        !this.isSlotUnavailable(m.bookingTime) &&
        // Never validate against a stale or missing availability answer: while a lookup is
        // running the list still belongs to the PREVIOUS date, and after a failed lookup
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
    return this.busySlots().includes(slot) || this.isSlotPast(slot);
  }

  /** Whether `slot` on the selected date has already started (shop-local time as the browser sees it). */
  isSlotPast(slot: string): boolean {
    return isSlotInPast(this.bookingDate(), slot, this.now());
  }

  /**
   * Re-reads the clock. Called on wizard entry, when the tab becomes visible again,
   * at local midnight, and when a date is picked. Drops a selection the new "now"
   * has invalidated (a date that passed, a same-day time that started).
   */
  refreshToday(): void {
    this.now.set(new Date());
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
      // +1s so the refresh lands safely after midnight even with timer drift.
      timer = setTimeout(
        () => {
          this.refreshToday();
          arm();
        },
        msUntilNextLocalMidnight(new Date()) + 1000,
      );
    };
    arm();

    owner.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  private revalidateSelection(): void {
    const m = this.bookingModel();
    const now = this.now();
    if (m.bookingDate && !isBookableDate(m.bookingDate, now)) {
      this.bookingModel.update((model) => ({ ...model, bookingDate: '' }));
      this.busySlotsRequestSeq++; // invalidate any in-flight lookup for the dead date
      this.isCheckingSlots.set(false);
      this.slotsError.set(null);
      this.busySlots.set([]);
      this.errorMessage.set(
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

  /** First slot of `date` that has not started yet and is not known to be taken ('' if none). */
  private firstOpenSlot(date: string): string {
    const now = this.now();
    return (
      this.timeSlots.find((s) => !isSlotInPast(date, s, now) && !this.busySlots().includes(s)) ?? ''
    );
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
        this.onBarberOrDateChange();
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
    if (!isBookableDate(dateStr, this.now())) {
      this.errorMessage.set(
        `Please pick a date from today up to ${MAX_BOOKING_DAYS_AHEAD} days ahead.`,
      );
      return;
    }
    this.bookingModel.update((m) => ({ ...m, bookingDate: dateStr }));
    // The preselected default time may already be over on the chosen day (today).
    const time = this.bookingTime();
    if (isSlotInPast(dateStr, time, this.now())) {
      this.bookingModel.update((m) => ({ ...m, bookingTime: this.firstOpenSlot(dateStr) }));
    }
    this.onBarberOrDateChange();
  }

  selectTimeSlot(slot: string): void {
    if (!this.isSlotUnavailable(slot)) {
      this.bookingModel.update((m) => ({ ...m, bookingTime: slot }));
    }
  }

  onBarberOrDateChange(): void {
    const barber = this.bookingBarber();
    const date = this.bookingDate();
    if (barber && date) {
      // 1. Sunday Lock Check
      const selectedDateObj = new Date(date);
      const dayOfWeek = selectedDateObj.getUTCDay();
      if (dayOfWeek === 0) {
        this.busySlotsRequestSeq++; // invalidate any in-flight lookup
        this.isCheckingSlots.set(false);
        this.errorMessage.set(
          'Our shop is closed on Sundays. Please select a Monday through Saturday slot!',
        );
        this.bookingModel.update((m) => ({ ...m, bookingDate: '' }));
        this.slotsError.set(null);
        this.busySlots.set([]);
        return;
      }

      const seq = ++this.busySlotsRequestSeq;
      this.isCheckingSlots.set(true);
      this.slotsError.set(null);
      this.appointmentsApi
        .getBusySlots(barber, date, this.bookingService() || undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (busy) => {
            if (seq !== this.busySlotsRequestSeq) return; // stale response
            this.busySlots.set(busy);
            this.isCheckingSlots.set(false);
          },
          error: (err) => {
            if (seq !== this.busySlotsRequestSeq) return; // stale response
            // Availability is UNKNOWN, not "everything is free": showing every slot as open
            // would invite a booking the server may refuse. Keep step 3 blocked (see
            // isStepValid) until a lookup succeeds; the grid offers a retry.
            this.busySlots.set([]);
            this.slotsError.set(
              extractApiError(err, 'Could not check availability. Please try again.'),
            );
            this.isCheckingSlots.set(false);
          },
        });
    } else {
      this.busySlotsRequestSeq++; // invalidate any in-flight lookup
      this.isCheckingSlots.set(false);
      this.slotsError.set(null);
      this.busySlots.set([]);
    }
  }

  // Submit Guest Booking (Client Calendar Interface)
  submitBooking(): void {
    // Time may have moved on while the form was open (tab left idle past the slot, or
    // past midnight): re-read the clock first so the checks below use a fresh selection.
    const chosenTime = this.bookingTime();
    this.refreshToday();
    const model = this.bookingModel();
    const name = model.customerName.trim();
    const email = model.customerEmail.trim();
    const phone = model.customerPhone.trim();

    if (!model.bookingDate) {
      // The chosen date is gone (refreshToday() said why) or never picked: back to step 3.
      this.errorMessage.set(
        this.errorMessage() ?? 'Please pick a date and time to secure your slot.',
      );
      this.activeStep.set(3);
      return;
    }

    if (!name || !email || !phone) {
      this.errorMessage.set('Please fill out all required fields to secure your slot.');
      return;
    }

    // Catch an address the server would reject BEFORE the round trip ("a@b").
    const emailProblem = this.emailError();
    if (emailProblem) {
      this.errorMessage.set(emailProblem);
      return;
    }

    if (model.bookingTime !== chosenTime) {
      // The slot started while the form sat open and refreshToday() moved the selection:
      // never submit a time the customer did not pick.
      this.errorMessage.set('That time has already passed. Please pick a later slot.');
      this.activeStep.set(3);
      return;
    }

    if (this.isCheckingSlots() || this.slotsError()) {
      this.errorMessage.set(
        this.slotsError() ?? 'Still checking availability. Please try again in a moment.',
      );
      return;
    }

    // The slot may have been taken by another guest since the last availability
    // check — refuse the stale slot and refresh the grid instead of submitting
    // blindly (B4).
    if (this.busySlots().includes(model.bookingTime)) {
      this.errorMessage.set('That time slot was just taken. Please pick another slot.');
      this.onBarberOrDateChange();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
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
          this.errorMessage.set(extractApiError(err, 'Failed to submit booking request.'));
          this.isSubmitting.set(false);
        },
      });
  }

  // Reset Guest Form (mutate model — convenience signals reflect automatically)
  resetBookingForm(): void {
    const defaultService = this.services()[0]?.name ?? '';
    this.bookingModel.set({
      customerName: this.sessionContact.customerName,
      customerEmail: this.sessionContact.customerEmail,
      customerPhone: this.sessionContact.customerPhone,
      barberName: this.noPreferenceLabel,
      bookingDate: '',
      bookingTime: this.timeSlots[0] ?? '',
      serviceType: defaultService,
    });
    this.selectedCategory.set('all');
    this.busySlotsRequestSeq++; // invalidate any in-flight slot lookup
    this.busySlots.set([]);
    this.slotsError.set(null);
    this.isCheckingSlots.set(false);
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
