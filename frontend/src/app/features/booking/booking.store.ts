import { Injectable, signal, computed, inject, DestroyRef, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, required } from '@angular/forms/signals';
import { AppointmentItem } from '../../types/api';
import { DEFAULT_TIME_SLOTS, computeEstimatedEndTime } from '../../time-utils';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { AppointmentStore } from '../../appointment.store';
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
  private readonly destroyRef = inject(DestroyRef);

  readonly noPreferenceLabel = 'No Preference (First Available)';
  readonly timeSlots = DEFAULT_TIME_SLOTS;
  readonly services = this.catalogStore.services;

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
    const today = new Date();

    let count = 0;
    let offset = 0;
    while (count < 7 && offset < 14) {
      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + offset);

      const dayOfWeek = nextDate.getDay();
      if (dayOfWeek !== 0) {
        // Skip Sundays since we are closed. Use local date components to avoid
        // the UTC shift `toISOString()` would introduce in US/EU timezones.
        const year = nextDate.getFullYear();
        const month = String(nextDate.getMonth() + 1).padStart(2, '0');
        const day = String(nextDate.getDate()).padStart(2, '0');
        days.push({
          dateStr: `${year}-${month}-${day}`,
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

  onSearchChange(value: string): void {
    this.serviceSearchQuery.set(value);
  }

  setServiceCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  selectService(name: string): void {
    this.bookingModel.update((m) => ({ ...m, serviceType: name }));
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
      return !!m.bookingDate && !!m.bookingTime && !this.busySlots().includes(m.bookingTime);
    }
    if (step === 4) {
      return !!m.customerName.trim() && !!m.customerEmail.trim() && !!m.customerPhone.trim();
    }
    return false;
  }

  setStep(step: number): void {
    if (step < this.activeStep() || this.isStepValid(step - 1)) {
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
    this.bookingModel.update((m) => ({ ...m, bookingDate: dateStr }));
    this.onBarberOrDateChange();
  }

  selectTimeSlot(slot: string): void {
    if (!this.busySlots().includes(slot)) {
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
        this.busySlots.set([]);
        return;
      }

      const seq = ++this.busySlotsRequestSeq;
      this.isCheckingSlots.set(true);
      this.appointmentsApi
        .getBusySlots(barber, date)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (busy) => {
            if (seq !== this.busySlotsRequestSeq) return; // stale response
            this.busySlots.set(busy);
            this.isCheckingSlots.set(false);
          },
          error: () => {
            if (seq !== this.busySlotsRequestSeq) return; // stale response
            this.busySlots.set([]);
            this.isCheckingSlots.set(false);
          },
        });
    } else {
      this.busySlotsRequestSeq++; // invalidate any in-flight lookup
      this.isCheckingSlots.set(false);
      this.busySlots.set([]);
    }
  }

  // Submit Guest Booking (Client Calendar Interface)
  submitBooking(): void {
    const model = this.bookingModel();
    const name = model.customerName.trim();
    const email = model.customerEmail.trim();
    const phone = model.customerPhone.trim();

    if (!name || !email || !phone || !model.bookingDate) {
      this.errorMessage.set('Please fill out all required fields to secure your slot.');
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

    const payload = {
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      barberName: model.barberName,
      bookingDate: model.bookingDate,
      bookingTime: model.bookingTime,
      serviceType: model.serviceType,
    };

    this.appointmentsApi
      .createAppointment(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.isSubmitting.set(false);
          this.lastBookedAppointment.set(created);
          this.showReceiptModal.set(true);
          this.resetBookingForm();
        },
        error: (err) => {
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
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      barberName: this.noPreferenceLabel,
      bookingDate: '',
      bookingTime: this.timeSlots[0] ?? '',
      serviceType: defaultService,
    });
    this.selectedCategory.set('all');
    this.busySlotsRequestSeq++; // invalidate any in-flight slot lookup
    this.busySlots.set([]);
    this.activeStep.set(1);
    this.isSubmitting.set(false);
  }
}
