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
import { BarberStore } from './barber.store';
import { NotificationStore } from './notification.store';
import { ReviewStore } from './review.store';
import { formatTime12Hour, isOverdue } from './time-utils';
import { CustomerStore } from './customer.store';
import { StylistCard } from './components/stylist-card/stylist-card';
import { LookbookComponent } from './components/lookbook/lookbook';
import { PostBookingActionsComponent } from './components/post-booking-actions/post-booking-actions';
import { AuthModalComponent } from './components/auth-modal/auth-modal';

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
  private readonly barberStore = inject(BarberStore);
  private readonly notificationStore = inject(NotificationStore);
  private readonly reviewStore = inject(ReviewStore);
  readonly customerStore = inject(CustomerStore);
  private readonly router = inject(Router);
  private readonly authState = inject(AuthState);
  private readonly destroyRef = inject(DestroyRef);

  // Authentication State delegated to the Store (Top-Tier DDD State management)
  // A1.2: role is held ONLY in memory via AuthState — never trusted from sessionStorage.
  readonly isLoggedIn = this.store.isLoggedIn;
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
  readonly appointments = this.store.appointments;
  readonly searchQuery = this.store.searchQuery;
  readonly selectedFilter = this.store.selectedFilter;

  // Pagination State delegated to the Store
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;

  // Global Dashboard Stats delegated to the Store
  readonly stats = this.store.stats;

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
    },
    {
      name: 'Sara the Stylist',
      title: 'Skin Fade Expert',
      specialty: 'Skin Fades & Tapers',
    },
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
  readonly timeSlots = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
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
        const dateStr = nextDate.toISOString().split('T')[0];
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

    this.catalogStore.loadServices();
    this.reviewStore.loadRatings();
    // A1.2: restore UI role from the backend if a session cookie exists (survives
    // refresh). The role lives only in memory — never read from sessionStorage.
    // bootstrap() calls me() internally and sets the role signal when complete.
    this.authState
      .bootstrap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (role) => {
          if (role) {
            this.isLoggedIn.set(true);
            this.loadAppointments();
            this.router.navigateByUrl(this.authState.dashboardPathFor(role));
          }
        },
        error: () => {
          // No active session — stay logged out.
          this.isLoggedIn.set(false);
        },
      });
  }

  // Called after a successful login from the deferred AuthModalComponent.
  onAuthLoginSuccess(role: string): void {
    this.showSuccess(role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!');
    this.loadAppointments();
    this.router.navigateByUrl(this.authState.dashboardPathFor(role));
  }

  // Admin View State
  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>(
    'appointments',
  );

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
    this.adminView.set(view);
    if (view === 'schedules') {
      this.barberStore.loadBarbers();
    } else if (view === 'notifications') {
      this.notificationStore.loadNotifications();
    }
  }

  // --- Barber Schedule Admin ---
  readonly barbersList = this.barberStore.barbers;
  readonly timeOffs = this.barberStore.timeOffs;
  readonly selectedBarberId = this.barberStore.selectedBarberId;

  readonly newTimeOffStartDate = signal('');
  readonly newTimeOffEndDate = signal('');
  readonly newTimeOffReason = signal('');

  addTimeOff(): void {
    if (!this.newTimeOffStartDate() || !this.newTimeOffEndDate()) {
      this.errorMessage.set('Start and end dates are required.');
      return;
    }
    this.barberStore.addTimeOff({
      startDate: this.newTimeOffStartDate(),
      endDate: this.newTimeOffEndDate(),
      reason: this.newTimeOffReason(),
    });
    this.showSuccess('Time off added successfully.');
    this.newTimeOffStartDate.set('');
    this.newTimeOffEndDate.set('');
    this.newTimeOffReason.set('');
  }

  selectAdminBarber(id: number): void {
    this.barberStore.selectBarber(id);
  }

  // --- Notification Outbox Admin ---
  readonly notificationsList = this.notificationStore.notifications;

  // Handle Admin Logout delegated to the Store
  onLogout(): void {
    this.store.onLogout();
    this.authState.clear();
    this.isLoggedIn.set(false);
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
          console.error(
            'CREATE APPT ERROR STATUS:',
            err.status,
            'MESSAGE:',
            err.message,
            'BODY:',
            err.error,
          );
          this.errorMessage.set(err.error?.message || 'Failed to submit booking request.');
          this.isSubmitting.set(false);
        },
      });
  }

  // Load Paginated Bookings from Backend (Delegated to the Store)
  loadAppointments(): void {
    if (this.userRole() === 'ROLE_CUSTOMER') {
      this.customerStore.loadAppointments();
    } else {
      this.store.loadAppointments(this.selectedFilter(), this.searchQuery());
    }
  }

  // Approve Booking
  approveAppointment(id: number): void {
    this.appointmentService
      .updateAppointmentStatus(id, 'APPROVED')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showSuccess('Appointment APPROVED! Client notification email dispatched.');
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to approve appointment.'),
      });
  }

  // Deny Booking
  denyAppointment(id: number): void {
    this.appointmentService
      .updateAppointmentStatus(id, 'DENIED')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showSuccess('Appointment DECLINED. Client notification email dispatched.');
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to decline appointment.'),
      });
  }

  // Delete/Cancel Booking
  deleteAppointment(id: number): void {
    if (confirm('Are you sure you want to permanently delete/cancel this booking?')) {
      this.appointmentService
        .deleteAppointment(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.showSuccess('Booking permanently deleted.');
            if (this.appointments().length === 1 && this.currentPage() > 0) {
              this.currentPage.update((p) => p - 1);
            }
            this.loadAppointments();
          },
          error: () => this.errorMessage.set('Failed to delete booking.'),
        });
    }
  }

  // Set Admin Dashboard Filters
  setFilter(filter: string): void {
    this.selectedFilter.set(filter);
    this.currentPage.set(0); // Reset page
    this.loadAppointments();
  }

  // Search Input change handler (debounced to avoid a request per keystroke - P2)
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(0); // Reset page

    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.loadAppointments();
    }, 300);
  }

  // Page Controls
  setPage(page: number): void {
    if (page >= 0 && page < this.totalPages()) {
      this.currentPage.set(page);
      this.loadAppointments();
    }
  }

  nextPage(): void {
    this.setPage(this.currentPage() + 1);
  }

  prevPage(): void {
    this.setPage(this.currentPage() - 1);
  }

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

  onBarberOrDateChange(): void {
    const barber = this.bookingBarber();
    const date = this.bookingDate();
    if (barber && date) {
      // 1. Sunday Lock Check
      const selectedDateObj = new Date(date);
      const dayOfWeek = selectedDateObj.getUTCDay();
      if (dayOfWeek === 0) {
        // 0 represents Sunday
        this.errorMessage.set(
          'Our shop is closed on Sundays. Please select a Monday through Saturday slot!',
        );
        this.bookingModel.update((m) => ({ ...m, bookingDate: '' }));
        this.busySlots.set([]);
        return;
      }

      this.isCheckingSlots.set(true);
      this.appointmentService
        .getBusySlots(barber, date)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
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
  submitReview(publicId: string, rating: number, comment: string): void {
    if (!publicId) {
      this.errorMessage.set('Booking Code is required to submit a review.');
      return;
    }

    this.isSubmitting.set(true);
    this.appointmentService
      .submitReview(publicId, { rating, comment })
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
