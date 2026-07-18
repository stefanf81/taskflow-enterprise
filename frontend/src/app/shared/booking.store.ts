import { Service, signal, computed, inject } from '@angular/core';
import { AppointmentService, AppointmentItem, ServiceItem } from '../appointment.service';
import { ServiceCatalogStore } from '../service-catalog.store';
import { ReviewStore } from '../review.store';

/** A single selectable day in the booking carousel. */
export interface BookingDay {
  dateStr: string;
  dayName: string;
  dayNum: number;
  monthName: string;
}

/**
 * Holds all client-side booking wizard state (signals) plus the helper
 * computations and HTTP calls used by both the Home lookbook and the Booking
 * page. Kept as a singleton so the lookbook and the stepper share one source
 * of truth without prop-drilling.
 */
@Service()
export class BookingStore {
  private readonly appointmentService = inject(AppointmentService);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly reviewStore = inject(ReviewStore);

  // --- Guest Booking Form State ---
  readonly bookingName = signal<string>('');
  readonly bookingEmail = signal<string>('');
  readonly bookingPhone = signal<string>('');
  readonly bookingBarber = signal<string>('No Preference (First Available)');
  readonly bookingDate = signal<string>('');
  readonly bookingTime = signal<string>('09:00');
  readonly bookingService = signal<string>('Classic Haircut');

  // Stepper / UI state
  readonly activeStep = signal<number>(1);
  readonly selectedCategory = signal<string>('all');
  readonly serviceSearchQuery = signal<string>('');
  readonly activeFaq = signal<number | null>(null);
  readonly isCheckingSlots = signal<boolean>(false);
  readonly busySlots = signal<string[]>([]);

  // Receipt modal
  readonly showReceiptModal = signal<boolean>(false);
  readonly lastBookedAppointment = signal<AppointmentItem | null>(null);

  // Booking submit feedback (kept in this store so Booking never depends on
  // the appointment/admin store for its own UI alerts).
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  // Preset options
  readonly barbers = [
    'No Preference (First Available)',
    'Alex the Barber',
    'Sara the Stylist',
    'Marcus Master Blade',
  ];
  readonly timeSlots = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
  readonly services = this.catalogStore.services;

  readonly rawProfiles = [
    { name: 'Alex the Barber', title: 'Master Stylist', specialty: 'Classic Scissor Cuts' },
    { name: 'Sara the Stylist', title: 'Skin Fade Expert', specialty: 'Skin Fades & Tapers' },
    {
      name: 'Marcus Master Blade',
      title: 'Director Barber',
      specialty: 'Razor Shaves & Beards',
    },
  ];

  readonly stylistProfiles = computed(() => {
    const ratings = this.reviewStore.ratings();
    return this.rawProfiles.map((p) => {
      const dbRating = ratings.find((r) => r.barberName === p.name);
      if (dbRating) {
        return {
          ...p,
          rating: `${dbRating.averageRating.toFixed(1)} ★`,
          reviews: `${dbRating.reviewCount} reviews`,
        };
      }
      return { ...p, rating: '5.0 ★', reviews: 'New' };
    });
  });

  readonly upcomingBookingDays = computed<BookingDay[]>(() => {
    const days: BookingDay[] = [];
    const today = new Date();
    let count = 0;
    let offset = 0;
    while (count < 7 && offset < 14) {
      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + offset);
      const dayOfWeek = nextDate.getDay();
      if (dayOfWeek !== 0) {
        const dateStr = nextDate.toISOString().split('T')[0];
        days.push({
          dateStr,
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

  readonly filteredServices = computed<ServiceItem[]>(() => {
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

  readonly selectedServiceObj = computed<ServiceItem | undefined>(() =>
    this.services().find((s) => s.name === this.bookingService()),
  );

  readonly estimatedEndTime = computed<string>(() => {
    const svc = this.selectedServiceObj();
    if (!svc || !this.bookingTime()) return '';
    try {
      const startMin = this.parseTimeToMinutes(this.bookingTime());
      const endMin = startMin + svc.durationMinutes;
      return this.formatMinutesToTimeString(endMin);
    } catch {
      return '';
    }
  });

  readonly checkoutSubtotal = computed(() => {
    const svc = this.selectedServiceObj();
    return svc ? svc.price : 0;
  });

  readonly checkoutFee = computed(() => 2.5);
  readonly checkoutTotal = computed(() => this.checkoutSubtotal() + this.checkoutFee());

  isStepValid(step: number): boolean {
    if (step === 1) return !!this.bookingService();
    if (step === 2) return !!this.bookingBarber();
    if (step === 3) {
      return (
        !!this.bookingDate() &&
        !!this.bookingTime() &&
        !this.busySlots().includes(this.bookingTime())
      );
    }
    if (step === 4) {
      return (
        !!this.bookingName().trim() && !!this.bookingEmail().trim() && !!this.bookingPhone().trim()
      );
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

  selectStylist(name: string): void {
    this.bookingBarber.set(name);
    this.onBarberOrDateChange();
  }

  selectLookbookStyle(serviceName: string, category: string): void {
    this.bookingService.set(serviceName);
    this.selectedCategory.set(category);
    this.activeStep.set(2);
  }

  toggleFaq(index: number): void {
    this.activeFaq.set(this.activeFaq() === index ? null : index);
  }

  selectTimeSlot(slot: string): void {
    if (!this.busySlots().includes(slot)) {
      this.bookingTime.set(slot);
    }
  }

  selectBookingDate(dateStr: string): void {
    this.bookingDate.set(dateStr);
    this.onBarberOrDateChange();
  }

  selectService(name: string): void {
    this.bookingService.set(name);
  }

  setServiceCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  setServiceSearchQuery(query: string): void {
    this.serviceSearchQuery.set(query);
  }

  onBarberOrDateChange(): void {
    const barber = this.bookingBarber();
    const date = this.bookingDate();
    if (barber && date) {
      const selectedDateObj = new Date(date);
      const dayOfWeek = selectedDateObj.getUTCDay();
      if (dayOfWeek === 0) {
        this.busySlots.set([]);
        this.bookingDate.set('');
        return;
      }
      this.isCheckingSlots.set(true);
      this.appointmentService.getBusySlots(barber, date).subscribe({
        next: (busy) => {
          this.busySlots.set(busy);
          this.isCheckingSlots.set(false);
        },
        error: () => {
          this.busySlots.set([]);
          this.isCheckingSlots.set(false);
        },
      });
    } else {
      this.busySlots.set([]);
    }
  }

  resetBookingForm(): void {
    this.bookingName.set('');
    this.bookingEmail.set('');
    this.bookingPhone.set('');
    this.bookingBarber.set(this.barbers[0]);
    this.bookingDate.set('');
    this.bookingTime.set(this.timeSlots[0]);
    this.bookingService.set(this.services().length > 0 ? this.services()[0].name : '');
    this.selectedCategory.set('all');
    this.busySlots.set([]);
    this.activeStep.set(1);
  }

  formatTime12Hour(time24: string): string {
    if (!time24) return '';
    try {
      const parts = time24.split(':');
      let hours = parseInt(parts[0], 10);
      const minutes = parts[1] || '00';
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${hours}:${minutes} ${ampm}`;
    } catch {
      return time24;
    }
  }

  private parseTimeToMinutes(timeStr: string): number {
    if (!timeStr) return 0;
    try {
      const parts = timeStr.split(':');
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      return hours * 60 + minutes;
    } catch {
      return 0;
    }
  }

  private formatMinutesToTimeString(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const hrStr = hours < 10 ? '0' + hours : hours.toString();
    const minStr = minutes < 10 ? '0' + minutes : minutes.toString();
    return `${hrStr}:${minStr}`;
  }
}
