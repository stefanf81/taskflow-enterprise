import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TodoService, AppointmentItem, AppointmentStats } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  private readonly todoService = inject(TodoService);

  // Authentication State
  readonly isLoggedIn = signal<boolean>(!!sessionStorage.getItem('auth_token'));
  showAdminLoginModal = false; // Toggles Admin Login Modal
  loginUsername = '';
  loginPassword = '';

  // Client-Side Guest Booking Form State (Signals)
  readonly bookingName = signal<string>('');
  readonly bookingEmail = signal<string>('');
  readonly bookingPhone = signal<string>('');
  readonly bookingBarber = signal<string>('No Preference (First Available)');
  readonly bookingDate = signal<string>('');
  readonly bookingTime = signal<string>('09:00');
  readonly bookingService = signal<string>('Classic Haircut');

  // Core Admin Reactive States (Signals)
  readonly appointments = signal<AppointmentItem[]>([]);
  readonly searchQuery = signal<string>('');
  readonly selectedFilter = signal<string>('all');
  
  // Pagination State (Signals)
  readonly currentPage = signal<number>(0);
  readonly totalPages = signal<number>(1);
  readonly totalElements = signal<number>(0);
  readonly pageSize = 50;

  // Global Dashboard Stats (Signal)
  readonly stats = signal<AppointmentStats>({ total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 });

  // Alerts & Loading State (Signals)
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  // Dynamic Client-Side States & Filters
  readonly selectedCategory = signal<string>('all');
  readonly busySlots = signal<string[]>([]);
  readonly activeStep = signal<number>(1);
  readonly activeFaq = signal<number | null>(null);

  // SOTA Calendar Guards, Loaders & Self-Service Signals
  readonly todayStr = new Date().toISOString().split('T')[0];
  readonly isCheckingSlots = signal<boolean>(false);
  readonly serviceSearchQuery = signal<string>('');
  readonly showReceiptModal = signal<boolean>(false);
  readonly lastBookedAppointment = signal<any | null>(null);
  cancelBookingId = '';
  cancelEmail = '';

  // Stylist Profiles with Star Ratings
  readonly stylistProfiles = [
    { name: 'Alex the Barber', title: 'Master Stylist', rating: '4.9 ★', reviews: '142 reviews', specialty: 'Classic Scissor Cuts' },
    { name: 'Sara the Stylist', title: 'Skin Fade Expert', rating: '5.0 ★', reviews: '198 reviews', specialty: 'Skin Fades & Tapers' },
    { name: 'Marcus Master Blade', title: 'Director Barber', rating: '4.8 ★', reviews: '240 reviews', specialty: 'Razor Shaves & Beards' }
  ];

  // Preset Options for Booking Form
  readonly barbers = ['No Preference (First Available)', 'Alex the Barber', 'Sara the Stylist', 'Marcus Master Blade'];
  readonly timeSlots = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
  readonly services = [
    { name: 'Classic Haircut', price: 25, duration: 30, category: 'hair', desc: 'Precision cut tailored to your head shape, complete with razor neck cleanup and premium styling.' },
    { name: 'Modern Skin Fade', price: 30, duration: 45, category: 'hair', desc: 'Sleek blended skin fade with a crisp straight razor lineup and clay texturization.' },
    { name: 'Beard Trim & Shave', price: 18, duration: 25, category: 'beard', desc: 'Detail beard lineup, hot steam towel treatment, aromatic pre-shave oil massage, and soothing trim.' },
    { name: 'Royal Hot Towel Shave', price: 22, duration: 30, category: 'beard', desc: 'Traditional lather shaving using a straight razor blade, three rounds of steam towels, and cold-balm massage.' },
    { name: 'The Executive Package', price: 40, duration: 60, category: 'combo', desc: 'The ultimate royal experience: Classic Haircut, full Beard Shave, facial wash, and essential-oil head massage.' }
  ];

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
      if (dayOfWeek !== 0) { // Skip Sundays since we are closed
        const dateStr = nextDate.toISOString().split('T')[0];
        days.push({
          dateStr: dateStr,
          dayName: nextDate.toLocaleDateString('en-US', { weekday: 'short' }),
          dayNum: nextDate.getDate(),
          monthName: nextDate.toLocaleDateString('en-US', { month: 'short' })
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
    
    let list = this.services;
    if (cat !== 'all') {
      list = list.filter(s => s.category === cat);
    }
    if (query) {
      list = list.filter(s => s.name.toLowerCase().includes(query) || s.desc.toLowerCase().includes(query));
    }
    return list;
  });

  readonly selectedServiceObj = computed(() => {
    return this.services.find(s => s.name === this.bookingService());
  });

  readonly estimatedEndTime = computed(() => {
    const svc = this.selectedServiceObj();
    if (!svc || !this.bookingTime()) return '';
    try {
      const startMin = this.parseTimeToMinutes(this.bookingTime());
      const endMin = startMin + svc.duration;
      return this.formatMinutesToTimeString(endMin);
    } catch (e) {
      return '';
    }
  });

  ngOnInit(): void {
    if (this.isLoggedIn()) {
      this.loadAppointments();
    }
  }

  // Handle Admin Portal Login via JWT endpoint
  onLogin(): void {
    const user = this.loginUsername.trim();
    const pass = this.loginPassword.trim();
    
    if (!user || !pass) {
      this.errorMessage.set('Username and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.todoService.login(user, pass)
      .subscribe({
        next: (response) => {
          const tokenValue = 'Bearer ' + response.token;
          sessionStorage.setItem('auth_token', tokenValue);
          this.isLoggedIn.set(true);
          this.isSubmitting.set(false);
          this.showAdminLoginModal = false;
          this.errorMessage.set(null);
          
          this.loginUsername = '';
          this.loginPassword = '';
          this.showSuccess('Welcome back, Owner! Admin session started.');
          this.loadAppointments(); // Load bookings
        },
        error: (err) => {
          this.errorMessage.set('Invalid admin credentials. Please try again.');
          this.isSubmitting.set(false);
          console.error('Authentication error:', err);
        }
      });
  }

  // Handle Admin Logout
  onLogout(): void {
    sessionStorage.removeItem('auth_token');
    this.isLoggedIn.set(false);
    this.appointments.set([]);
    this.stats.set({ total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 });
    this.errorMessage.set(null);
    this.showSuccess('Admin logged out successfully.');
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
      serviceType: this.bookingService()
    };

    this.todoService.createAppointment(payload)
      .subscribe({
        next: (created) => {
          this.isSubmitting.set(false);
          this.lastBookedAppointment.set(created);
          this.showReceiptModal.set(true);
          this.resetBookingForm();
        },
        error: (err) => {
          console.error("CREATE APPT ERROR STATUS:", err.status, "MESSAGE:", err.message, "BODY:", err.error);
          this.errorMessage.set(err.error?.message || 'Failed to submit booking request.');
          this.isSubmitting.set(false);
        }
      });
  }

  // Load Paginated Bookings from Backend (Admin Only)
  loadAppointments(): void {
    if (!this.isLoggedIn()) return;

    this.todoService.getAllAppointments(this.selectedFilter(), this.searchQuery(), this.currentPage(), this.pageSize)
      .pipe(
        catchError(err => {
          if (err.status === 401) {
            this.onLogout();
            this.errorMessage.set('Session expired. Please log in again.');
          } else {
            this.errorMessage.set('Could not connect to the backend server. Please ensure the Spring Boot API is running.');
          }
          console.error('API Error:', err);
          return of({
            page: { content: [], totalPages: 1, totalElements: 0, size: this.pageSize, number: 0 },
            stats: { total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 }
          });
        })
      )
      .subscribe(data => {
        this.appointments.set(data.page.content);
        this.stats.set(data.stats);
        this.totalPages.set(data.page.totalPages);
        this.totalElements.set(data.page.totalElements);
        
        if (data.page.content.length > 0 && this.errorMessage() && this.errorMessage()!.startsWith('Could not connect')) {
          this.errorMessage.set(null);
        }
      });
  }

  // Approve Booking
  approveAppointment(id: number): void {
    this.todoService.updateAppointmentStatus(id, 'APPROVED')
      .subscribe({
        next: () => {
          this.showSuccess('Appointment APPROVED! Client notification email dispatched.');
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to approve appointment.')
      });
  }

  // Deny Booking
  denyAppointment(id: number): void {
    this.todoService.updateAppointmentStatus(id, 'DENIED')
      .subscribe({
        next: () => {
          this.showSuccess('Appointment DECLINED. Client notification email dispatched.');
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to decline appointment.')
      });
  }

  // Delete/Cancel Booking
  deleteAppointment(id: number): void {
    if (confirm('Are you sure you want to permanently delete/cancel this booking?')) {
      this.todoService.deleteAppointment(id)
        .subscribe({
          next: () => {
            this.showSuccess('Booking permanently deleted.');
            if (this.appointments().length === 1 && this.currentPage() > 0) {
              this.currentPage.update(p => p - 1);
            }
            this.loadAppointments();
          },
          error: () => this.errorMessage.set('Failed to delete booking.')
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
    this.bookingService.set(this.services[0].name);
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
      return !!this.bookingDate() && !!this.bookingTime() && !this.busySlots().includes(this.bookingTime());
    }
    if (step === 4) {
      return !!this.bookingName().trim() && !!this.bookingEmail().trim() && !!this.bookingPhone().trim();
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
      this.activeStep.update(s => s + 1);
      if (this.activeStep() === 3) {
        this.onBarberOrDateChange();
      }
    }
  }

  goToPrevStep(): void {
    if (this.activeStep() > 1) {
      this.activeStep.update(s => s - 1);
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
    return 2.50; // standard SOTA platform fee
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
    this.todoService.publicCancelAppointment(publicId, email)
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.cancelBookingId = '';
          this.cancelEmail = '';
          this.showSuccess('🗑️ Reservation successfully cancelled and deleted from our calendar.');
          this.onBarberOrDateChange();
        },
        error: (err) => {
          this.errorMessage.set(err.error?.message || 'Verification failed. Please check your Booking Code and Email.');
          this.isSubmitting.set(false);
        }
      });
  }

  onBarberOrDateChange(): void {
    const barber = this.bookingBarber();
    const date = this.bookingDate();
    if (barber && date) {
      // 1. Sunday Lock Check
      const selectedDateObj = new Date(date);
      const dayOfWeek = selectedDateObj.getUTCDay();
      if (dayOfWeek === 0) { // 0 represents Sunday
        this.errorMessage.set('Our shop is closed on Sundays. Please select a Monday through Saturday slot!');
        this.bookingDate.set('');
        this.busySlots.set([]);
        return;
      }

      this.isCheckingSlots.set(true);
      this.todoService.getBusySlots(barber, date)
        .subscribe({
          next: (busy) => {
            this.busySlots.set(busy);
            this.isCheckingSlots.set(false);
          },
          error: () => {
            this.busySlots.set([]);
            this.isCheckingSlots.set(false);
          }
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
}
