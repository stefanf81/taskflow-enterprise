import {
  Component,
  OnInit,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TodoService, AppointmentItem, AppointmentStats } from './todo.service';
import { AppointmentStore } from './appointment.store';
import { ServiceCatalogStore } from './service-catalog.store';
import { BarberStore } from './barber.store';
import { NotificationStore } from './notification.store';
import { ReviewStore } from './review.store';
import { CustomerStore } from './customer.store';
import { StylistCard } from './components/stylist-card/stylist-card';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, StylistCard],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly todoService = inject(TodoService);
  private readonly store = inject(AppointmentStore);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly barberStore = inject(BarberStore);
  private readonly notificationStore = inject(NotificationStore);
  private readonly reviewStore = inject(ReviewStore);
  readonly customerStore = inject(CustomerStore);

  // Authentication State delegated to the Store (Top-Tier DDD State management)
  readonly isLoggedIn = this.store.isLoggedIn;
  readonly userRole = signal<string>(sessionStorage.getItem('auth_role') || '');
  showAdminLoginModal = false; // Toggles Admin/Customer Login Modal
  loginUsername = '';
  loginPassword = '';
  isRegisterMode = false;
  registerFullName = '';
  registerPhone = '';

  // Client-Side Guest Booking Form State (Signals)
  readonly bookingName = signal<string>('');
  readonly bookingEmail = signal<string>('');
  readonly bookingPhone = signal<string>('');
  readonly bookingBarber = signal<string>('No Preference (First Available)');
  readonly bookingDate = signal<string>('');
  readonly bookingTime = signal<string>('09:00');
  readonly bookingService = signal<string>('Classic Haircut');

  // Core Admin Reactive States delegated to the Store
  readonly appointments = this.store.appointments;
  readonly searchQuery = signal<string>('');
  readonly selectedFilter = signal<string>('all');

  // Pagination State delegated to the Store
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  readonly totalElements = this.store.totalElements;
  readonly pageSize = this.store.pageSize;

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
  readonly todayStr = new Date().toISOString().split('T')[0];
  readonly isCheckingSlots = this.store.isCheckingSlots;
  readonly serviceSearchQuery = signal<string>('');
  readonly showReceiptModal = signal<boolean>(false);
  readonly lastBookedAppointment = signal<any | null>(null);
  cancelBookingId = '';
  cancelEmail = '';

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
    return this.rawProfiles.map(p => {
      const dbRating = ratings.find(r => r.barberName === p.name);
      if (dbRating) {
        return {
          ...p,
          rating: `${dbRating.averageRating.toFixed(1)} ★`,
          reviews: `${dbRating.reviewCount} reviews`
        };
      }
      return {
        ...p,
        rating: '5.0 ★', // default
        reviews: 'New'
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
    return this.services().find((s) => s.name === this.bookingService());
  });

  readonly estimatedEndTime = computed(() => {
    const svc = this.selectedServiceObj();
    if (!svc || !this.bookingTime()) return '';
    try {
      const startMin = this.parseTimeToMinutes(this.bookingTime());
      const endMin = startMin + svc.durationMinutes;
      return this.formatMinutesToTimeString(endMin);
    } catch (e) {
      return '';
    }
  });

  ngOnInit(): void {
    this.catalogStore.loadServices();
    this.reviewStore.loadRatings();
    if (this.isLoggedIn()) {
      this.loadAppointments();
    }
  }

  // Handle Admin/Customer Portal Login via JWT endpoint
  onLogin(): void {
    if (this.isRegisterMode) {
      this.onRegister();
      return;
    }

    const user = this.loginUsername.trim();
    const pass = this.loginPassword.trim();

    if (!user || !pass) {
      this.errorMessage.set('Email and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.todoService.login(user, pass).subscribe({
      next: (response) => {
        const tokenValue = 'Bearer ' + response.token;
        sessionStorage.setItem('auth_token', tokenValue);
        sessionStorage.setItem('auth_role', response.role);
        this.isLoggedIn.set(true);
        this.userRole.set(response.role);
        this.isSubmitting.set(false);
        this.showAdminLoginModal = false;
        this.errorMessage.set(null);

        this.loginUsername = '';
        this.loginPassword = '';
        this.showSuccess(response.role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!');
        this.loadAppointments(); // Load bookings
      },
      error: (err) => {
        this.errorMessage.set('Invalid credentials. Please try again.');
        this.isSubmitting.set(false);
        console.error('Authentication error:', err);
      },
    });
  }

  onRegister(): void {
    const email = this.loginUsername.trim();
    const pass = this.loginPassword.trim();
    const name = this.registerFullName.trim();
    const phone = this.registerPhone.trim();

    if (!email || !pass || !name) {
      this.errorMessage.set('Name, email, and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.todoService.register({ email, password: pass, fullName: name, phone }).subscribe({
      next: () => {
        this.isRegisterMode = false;
        this.isSubmitting.set(false);
        this.showSuccess('Account created! You can now log in.');
        this.errorMessage.set(null);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to create account.');
        this.isSubmitting.set(false);
      },
    });
  }

  // Admin View State
  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>('appointments');

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
    this.adminView.set(view);
    if (view === 'schedules') {
      this.barberStore.loadBarbers();
    } else if (view === 'notifications') {
      this.notificationStore.loadNotifications();
    }
  }

  // --- Service Catalog Admin ---
  readonly newServiceName = signal('');
  readonly newServicePrice = signal<number | null>(null);
  readonly newServiceDuration = signal<number | null>(null);
  readonly newServiceCategory = signal('hair');
  readonly newServiceDesc = signal('');

  addService(): void {
    if (!this.newServiceName() || !this.newServicePrice() || !this.newServiceDuration()) {
      this.errorMessage.set('Name, price, and duration are required.');
      return;
    }
    this.catalogStore.addService({
      name: this.newServiceName(),
      price: this.newServicePrice()!,
      durationMinutes: this.newServiceDuration()!,
      category: this.newServiceCategory(),
      description: this.newServiceDesc()
    });
    this.showSuccess('Service added to catalog.');
    this.newServiceName.set('');
    this.newServicePrice.set(null);
    this.newServiceDuration.set(null);
    this.newServiceDesc.set('');
  }

  deleteService(id: number): void {
    if (confirm('Are you sure you want to delete this service?')) {
      this.catalogStore.deleteService(id);
      this.showSuccess('Service deleted.');
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
      reason: this.newTimeOffReason()
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
    this.userRole.set('');
    sessionStorage.removeItem('auth_role');
    this.showSuccess('Logged out successfully.');
  }

  // Submit Guest Booking (Client Calendar Interface)
  onBookAppointment(): void {
    const name = this.bookingName().trim();
    const email = this.bookingEmail().trim();
    const phone = this.bookingPhone().trim();

    if (!name || !email || !phone || !this.bookingDate()) {
      this.errorMessage.set('Please fill out all required fields to secure your slot.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const payload = {
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      barberName: this.bookingBarber(),
      bookingDate: this.bookingDate(),
      bookingTime: this.bookingTime(),
      serviceType: this.bookingService(),
    };

    this.todoService.createAppointment(payload).subscribe({
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
    this.todoService.updateAppointmentStatus(id, 'APPROVED').subscribe({
      next: () => {
        this.showSuccess('Appointment APPROVED! Client notification email dispatched.');
        this.loadAppointments();
      },
      error: () => this.errorMessage.set('Failed to approve appointment.'),
    });
  }

  // Deny Booking
  denyAppointment(id: number): void {
    this.todoService.updateAppointmentStatus(id, 'DENIED').subscribe({
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
      this.todoService.deleteAppointment(id).subscribe({
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

  // Search Input change handler
  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(0); // Reset page
    this.loadAppointments();
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

  // Reset Guest Form
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
    this.isSubmitting.set(false);
  }

  // Toggle Admin Login Modal View
  toggleAdminLoginModal(show: boolean): void {
    this.showAdminLoginModal = show;
    this.errorMessage.set(null);
  }

  isStepValid(step: number): boolean {
    if (step === 1) {
      return !!this.bookingService();
    }
    if (step === 2) {
      return !!this.bookingBarber();
    }
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

  // Interactive Lookbook Style Selector
  selectLookbookStyle(serviceName: string, category: string): void {
    this.bookingService.set(serviceName);
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
    if (!appt.bookingDate) return false;
    const todayStr = new Date().toISOString().split('T')[0];
    return appt.bookingDate < todayStr;
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

  onPublicCancel(): void {
    const publicId = this.cancelBookingId.trim();
    const email = this.cancelEmail.trim();
    if (!publicId || !email) {
      this.errorMessage.set('Please provide a valid Booking Code and Email address.');
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.todoService.publicCancelAppointment(publicId, email).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.cancelBookingId = '';
        this.cancelEmail = '';
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
        this.bookingDate.set('');
        this.busySlots.set([]);
        return;
      }

      this.isCheckingSlots.set(true);
      this.todoService.getBusySlots(barber, date).subscribe({
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
    } catch (e) {
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
    this.successMessage.set(msg);
    setTimeout(() => {
      this.successMessage.set(null);
    }, 4500);
  }

  // --- Review Submission ---
  reviewPublicId = '';
  reviewRating = 5;
  reviewComment = '';

  submitReview(): void {
    if (!this.reviewPublicId.trim()) {
      this.errorMessage.set('Booking Code is required to submit a review.');
      return;
    }

    this.isSubmitting.set(true);
    this.todoService.submitReview(this.reviewPublicId.trim(), {
      rating: this.reviewRating,
      comment: this.reviewComment
    }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.showSuccess('Thank you for your review! We appreciate your feedback.');
        this.reviewPublicId = '';
        this.reviewComment = '';
        this.reviewRating = 5;
        this.reviewStore.loadRatings();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to submit review. Ensure the code is correct and the appointment is completed.');
      }
    });
  }
}
