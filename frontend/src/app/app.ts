import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  DestroyRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  isDevMode,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { form, required, FormField, FormRoot } from '@angular/forms/signals';
import { Router, RouterOutlet } from '@angular/router';
import { AppointmentService, AppointmentItem } from './appointment.service';
import { AuthState } from './auth.state';
import { AppointmentStore } from './appointment.store';
import { ServiceCatalogStore } from './service-catalog.store';
import { ReviewStore } from './review.store';
import { formatTime12Hour, isOverdue, DEFAULT_TIME_SLOTS } from './time-utils';
import { StylistCard } from './components/stylist-card/stylist-card';
import { LookbookComponent } from './components/lookbook/lookbook';
import { PostBookingActionsComponent } from './components/post-booking-actions/post-booking-actions';
import { AuthModalComponent } from './components/auth-modal/auth-modal';
import { AnnouncementBarComponent } from './components/announcement-bar/announcement-bar';
import { FaqSectionComponent } from './components/faq-section/faq-section';
import { ReceiptModalComponent } from './components/receipt-modal/receipt-modal';

/** Model shape for the Signal Forms booking wizard. */
interface BookingFormModel {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  barberName: string;
  bookingDate: string;
  bookingTime: string;
  serviceType: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StylistCard,
    RouterOutlet,
    FormField,
    FormRoot,
    LookbookComponent,
    PostBookingActionsComponent,
    AuthModalComponent,
    AnnouncementBarComponent,
    FaqSectionComponent,
    ReceiptModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class App implements OnInit, OnDestroy {
  private readonly appointmentService = inject(AppointmentService);
  private readonly store = inject(AppointmentStore);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly reviewStore = inject(ReviewStore);
  private readonly router = inject(Router);
  private readonly authState = inject(AuthState);
  private readonly destroyRef = inject(DestroyRef);

  // Authentication State delegated to the Store (Top-Tier DDD State management)
  // A1.2: role is held ONLY in memory via AuthState — never trusted from sessionStorage.
  readonly isLoggedIn = this.authState.isLoggedIn;
  readonly userRole = this.authState.role;
  readonly showAdminLoginModal = signal(false);

  // Booking Form Model Interface (public for test access)
  readonly bookingModel = signal<BookingFormModel>({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    barberName: 'No Preference (First Available)',
    bookingDate: '',
    bookingTime: '09:00',
    serviceType: 'Classic Haircut',
  });

  // Angular 22 Signal Forms (field-level validation + two-way binding via [formField])
  readonly bookingForm = form(this.bookingModel, (f) => {
    required(f.customerName);
    required(f.customerEmail);
    required(f.customerPhone);
    required(f.bookingDate);
    required(f.bookingTime);
  });

  // Convenience computed signals for backward-compatible template display
  readonly bookingName = computed(() => this.bookingModel().customerName);
  readonly bookingEmail = computed(() => this.bookingModel().customerEmail);
  readonly bookingPhone = computed(() => this.bookingModel().customerPhone);
  readonly bookingBarber = computed(() => this.bookingModel().barberName);
  readonly bookingDate = computed(() => this.bookingModel().bookingDate);
  readonly bookingTime = computed(() => this.bookingModel().bookingTime);
  readonly bookingService = computed(() => this.bookingModel().serviceType);

  // Core Admin Reactive States delegated to the Store
  // (appointments/stats/filter/pagination now live only in AppointmentStore —
  // the dashboard components read them directly; these aliases were removed as
  // dead code since the guest template never referenced them.)

  // Alerts & Loading State delegated to the Store
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;
  readonly isSubmitting = this.store.isSubmitting;

  // Dynamic Client-Side States & Filters
  readonly selectedCategory = signal<string>('all');
  readonly busySlots = this.store.busySlots;
  readonly activeStep = signal<number>(1);
  readonly activeFaq = signal<number | null>(null);

  // SOTA Calendar Guards, Loaders & Self-Service Signals
  readonly isCheckingSlots = this.store.isCheckingSlots;
  readonly serviceSearchQuery = signal<string>('');
  readonly showReceiptModal = signal<boolean>(false);
  readonly lastBookedAppointment = signal<AppointmentItem | null>(null);
  // Signals moved to PostBookingActionsComponent (local state)

  // Stylist Profiles with Dynamic Star Ratings
  readonly rawProfiles = [
    {
      name: 'Alex the Barber',
      title: 'Master Stylist',
      specialty: 'Classic Scissor Cuts',
      badge: 'Top Rated',
    },
    {
      name: 'Sara the Stylist',
      title: 'Skin Fade Expert',
      specialty: 'Skin Fades & Tapers',
      badge: 'Featured',
    },
    {
      name: 'Marcus Master Blade',
      title: 'Director Barber',
      specialty: 'Razor Shaves & Beards',
      badge: 'Master Barber',
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
      return {
        ...p,
        rating: '5.0 ★', // default
        reviews: 'New',
      };
    });
  });

  // Preset Options for Booking Form
  readonly barbers = [
    'No Preference (First Available)',
    'Alex the Barber',
    'Sara the Stylist',
    'Marcus Master Blade',
  ];
  readonly timeSlots = DEFAULT_TIME_SLOTS;
  readonly services = this.catalogStore.services;

  // SOTA Signals-based Reactive Computations
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
        // Skip Sundays since we are closed
        // Use local date components to avoid UTC shift across timezones.
        // toISOString() would serialize to UTC, producing tomorrow's date in
        // US/EU timezones after midnight UTC (as early as 8 PM EDT).
        const year = nextDate.getFullYear();
        const month = String(nextDate.getMonth() + 1).padStart(2, '0');
        const day = String(nextDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        days.push({
          dateStr: dateStr,
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

  readonly selectedServiceObj = computed(() => {
    return this.services().find((s) => s.name === this.bookingModel().serviceType);
  });

  readonly estimatedEndTime = computed(() => {
    const svc = this.selectedServiceObj();
    const time = this.bookingModel().bookingTime;
    if (!svc || !time) return '';
    try {
      const startMin = this.parseTimeToMinutes(time);
      const endMin = startMin + svc.durationMinutes;
      return this.formatMinutesToTimeString(endMin);
    } catch (e) {
      return '';
    }
  });

  ngOnInit(): void {
    // Ensure the XSRF-TOKEN cookie is set before any state-changing request.
    // The backend's CookieCsrfTokenRepository sets the cookie on the response;
    // subsequent POST/PUT/DELETE requests from Angular will read it and attach
    // the X-XSRF-TOKEN header automatically via withXsrfConfiguration.
    this.appointmentService.fetchCsrfToken().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

    // Catalog + ratings are fetched eagerly by their httpResources at boot —
    // no manual reload here (would duplicate every request, B3).
    // A1.2: restore UI role from the backend if a session cookie exists (survives
    // refresh). The role lives only in memory — never read from sessionStorage.
    // bootstrap() calls me() internally and sets the role signal when complete.
    this.authState
      .bootstrap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (role) => {
          if (role) {
            // Appointments fetch reactively once AuthState flips to logged-in
            // (the admin/customer resources read isLoggedIn) — no explicit
            // reload needed here (avoids a duplicate request, B1).
            this.router.navigateByUrl(this.authState.dashboardPathFor(role));
          }
        },
        error: () => {
          // No active session — stay logged out.
          this.authState.clear();
        },
      });
  }

  // Called after a successful login from the deferred AuthModalComponent.
  onAuthLoginSuccess(role: string): void {
    this.showSuccess(role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!');
    // Appointments load reactively via the resources' isLoggedIn dependency.
    this.router.navigateByUrl(this.authState.dashboardPathFor(role));
  }

  // Admin View State (moved to AdminDashboard; kept here only for showAdminLoginModal)

  // --- Notification Outbox Admin (moved to AdminDashboard) ---

  // Handle Admin Logout delegated to the Store
  onLogout(): void {
    this.store.onLogout();
    this.authState.clear();
    this.showSuccess('Logged out successfully.');
  }

  // Submit Guest Booking (Client Calendar Interface)
  onBookAppointment(): void {
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

    this.appointmentService
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
          this.errorMessage.set(err.error?.message || 'Failed to submit booking request.');
          this.isSubmitting.set(false);
        },
      });
  }

  // Load Paginated Bookings from Backend (Delegated to the Store)
  // NOTE: admin filter/search/page handlers (setFilter/onSearchChange/setPage/
  // nextPage/prevPage) were removed — they were dead code since the guest
  // template does not render the admin list. The dashboard owns them now
  // (admin-dashboard.ts delegates straight to AppointmentStore).

  // Reset Guest Form (mutate model — convenience signals reflect automatically)
  resetBookingForm(): void {
    const defaultService = this.services().length > 0 ? this.services()[0].name : '';
    this.bookingModel.set({
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      barberName: this.barbers[0],
      bookingDate: '',
      bookingTime: this.timeSlots[0],
      serviceType: defaultService,
    });
    this.selectedCategory.set('all');
    this.busySlotsRequestSeq++; // invalidate any in-flight slot lookup
    this.busySlots.set([]);
    this.activeStep.set(1);
    this.isSubmitting.set(false);
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

  selectStylist(name: string): void {
    this.bookingModel.update((m) => ({ ...m, barberName: name }));
    this.onBarberOrDateChange();
  }

  // Interactive Lookbook Style Selector
  selectLookbookStyle(serviceName: string, category: string): void {
    this.bookingModel.update((m) => ({ ...m, serviceType: serviceName }));
    this.selectedCategory.set(category);
    this.activeStep.set(2); // Automatically proceed to stylist select
    this.showSuccess(`✨ Lookbook Style selected: ${serviceName}! Choose your stylist next.`);
  }

  // FAQ Accordion Handler
  toggleFaq(index: number): void {
    if (this.activeFaq() === index) {
      this.activeFaq.set(null);
    } else {
      this.activeFaq.set(index);
    }
  }

  // Check if an appointment is in the past
  isOverdue(appt: AppointmentItem): boolean {
    return isOverdue(appt);
  }

  // SOTA Helper methods for Luxury Barber Scheduler
  readonly checkoutSubtotal = computed(() => {
    const svc = this.selectedServiceObj();
    return svc ? svc.price : 0;
  });

  readonly checkoutFee = computed(() => {
    return 2.5; // standard SOTA platform fee
  });

  readonly checkoutTotal = computed(() => {
    return this.checkoutSubtotal() + this.checkoutFee();
  });

  // Zoneless-safe formatted signals (replaces Angular pipes on Signal values)
  readonly formattedBookingDate = computed(() => {
    const d = this.bookingDate();
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  readonly formattedSubtotal = computed(() => {
    return `$${this.checkoutSubtotal().toFixed(2)}`;
  });

  readonly formattedFee = computed(() => {
    return this.checkoutFee().toFixed(2);
  });

  readonly formattedTotal = computed(() => {
    return this.checkoutTotal().toFixed(2);
  });

  onPublicCancel(publicId: string, email: string): void {
    if (!publicId || !email) {
      this.errorMessage.set('Please provide a valid Booking Code and Email address.');
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.appointmentService
      .publicCancelAppointment(publicId, email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.showSuccess('🗑️ Reservation successfully cancelled and deleted from our calendar.');
          this.onBarberOrDateChange();
        },
        error: (err) => {
          this.errorMessage.set(
            err.error?.message || 'Verification failed. Please check your Booking Code and Email.',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  /**
   * Monotonic sequence for busy-slot lookups. Responses are ignored unless
   * they belong to the latest request, so a slow response for an earlier date
   * can never overwrite the slots of the currently selected date (B4).
   */
  private busySlotsRequestSeq = 0;

  onBarberOrDateChange(): void {
    const barber = this.bookingBarber();
    const date = this.bookingDate();
    if (barber && date) {
      // 1. Sunday Lock Check
      const selectedDateObj = new Date(date);
      const dayOfWeek = selectedDateObj.getUTCDay();
      if (dayOfWeek === 0) {
        // 0 represents Sunday
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
      this.appointmentService
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

  selectTimeSlot(slot: string): void {
    if (!this.busySlots().includes(slot)) {
      this.bookingModel.update((m) => ({ ...m, bookingTime: slot }));
    }
  }

  selectBookingDate(dateStr: string): void {
    this.bookingModel.update((m) => ({ ...m, bookingDate: dateStr }));
    this.onBarberOrDateChange();
  }

  selectService(name: string): void {
    this.bookingModel.update((m) => ({ ...m, serviceType: name }));
  }

  setServiceCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  private parseTimeToMinutes(timeStr: string): number {
    if (!timeStr) return 0;
    try {
      const parts = timeStr.split(':');
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      return hours * 60 + minutes;
    } catch (e) {
      return 0;
    }
  }

  private formatMinutesToTimeString(totalMinutes: number): string {
    let hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const hrStr = hours < 10 ? '0' + hours : hours.toString();
    const minStr = minutes < 10 ? '0' + minutes : minutes.toString();
    return `${hrStr}:${minStr}`;
  }

  private successTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
  }

  // Helper to show success alerts temporarily
  private showSuccess(msg: string): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
    this.successMessage.set(msg);
    this.successTimer = setTimeout(() => {
      this.successMessage.set(null);
      this.successTimer = null;
    }, 4500);
  }

  // --- Review Submission ---
  submitReview(publicId: string, rating: number, comment: string, email: string): void {
    if (!publicId) {
      this.errorMessage.set('Booking Code is required to submit a review.');
      return;
    }
    if (!email) {
      this.errorMessage.set('Verification email is required to submit a review.');
      return;
    }

    this.isSubmitting.set(true);
    this.appointmentService
      .submitReview(publicId, { rating, comment, customerEmail: email })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.showSuccess('Thank you for your review! We appreciate your feedback.');
          this.reviewStore.loadRatings();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.errorMessage.set(
            err.error?.message ||
              'Failed to submit review. Ensure the code is correct and the appointment is completed.',
          );
        },
      });
  }
}
