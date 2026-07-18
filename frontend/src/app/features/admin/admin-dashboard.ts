import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppointmentService, AppointmentItem } from '../../appointment.service';
import { AppointmentStore } from '../../appointment.store';
import { BarberStore } from '../../barber.store';
import { NotificationStore } from '../../notification.store';
import { CustomerStore } from '../../customer.store';

/**
 * Lazy-loaded Owner dashboard (route: /admin). Extracted from the monolithic
 * App shell so it is no longer part of the initial JS bundle (P1 route-level
 * code splitting). All shared state lives in the injectable singleton stores,
 * which this component re-uses directly.
 */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: '../../app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AdminDashboard {
  private readonly appointmentService = inject(AppointmentService);
  private readonly store = inject(AppointmentStore);
  private readonly barberStore = inject(BarberStore);
  private readonly notificationStore = inject(NotificationStore);
  readonly customerStore = inject(CustomerStore);
  private readonly router = inject(Router);

  readonly appointments = this.store.appointments;
  readonly searchQuery = this.store.searchQuery;
  readonly selectedFilter = this.store.selectedFilter;
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  readonly stats = this.store.stats;
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>(
    'appointments',
  );
  readonly barbersList = this.barberStore.barbers;
  readonly timeOffs = this.barberStore.timeOffs;
  readonly selectedBarberId = this.barberStore.selectedBarberId;
  readonly timeOffActionError = this.barberStore.actionErrorMessage;
  readonly timeOffActionSuccess = this.barberStore.actionSuccessMessage;
  readonly isSavingTimeOff = this.barberStore.isSaving;
  readonly newTimeOffStartDate = signal('');
  readonly newTimeOffEndDate = signal('');
  readonly newTimeOffReason = signal('');
  readonly notificationsList = this.notificationStore.notifications;

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
    this.adminView.set(view);
    if (view === 'schedules') {
      this.barberStore.loadBarbers();
    } else if (view === 'notifications') {
      this.notificationStore.loadNotifications();
    }
  }

  addTimeOff(): void {
    if (!this.newTimeOffStartDate() || !this.newTimeOffEndDate()) {
      this.errorMessage.set('Start and end dates are required.');
      return;
    }
    // Clear any stale alert before the async write.
    this.successMessage.set(null);
    this.barberStore.addTimeOff({
      startDate: this.newTimeOffStartDate(),
      endDate: this.newTimeOffEndDate(),
      reason: this.newTimeOffReason(),
    });
    this.newTimeOffStartDate.set('');
    this.newTimeOffEndDate.set('');
    this.newTimeOffReason.set('');
  }

  selectAdminBarber(id: number): void {
    this.barberStore.selectBarber(id);
  }

  loadAppointments(): void {
    this.store.loadAppointments(this.selectedFilter(), this.searchQuery());
  }

  approveAppointment(id: number): void {
    this.appointmentService.updateAppointmentStatus(id, 'APPROVED').subscribe({
      next: () => {
        this.successMessage.set('Appointment APPROVED! Client notification email dispatched.');
        this.loadAppointments();
      },
      error: () => this.errorMessage.set('Failed to approve appointment.'),
    });
  }

  denyAppointment(id: number): void {
    this.appointmentService.updateAppointmentStatus(id, 'DENIED').subscribe({
      next: () => {
        this.successMessage.set('Appointment DECLINED. Client notification email dispatched.');
        this.loadAppointments();
      },
      error: () => this.errorMessage.set('Failed to decline appointment.'),
    });
  }

  deleteAppointment(id: number): void {
    if (confirm('Are you sure you want to permanently delete/cancel this booking?')) {
      this.appointmentService.deleteAppointment(id).subscribe({
        next: () => {
          this.successMessage.set('Booking permanently deleted.');
          if (this.appointments().length === 1 && this.currentPage() > 0) {
            this.currentPage.update((p) => p - 1);
          }
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to delete booking.'),
      });
    }
  }

  setFilter(filter: string): void {
    this.selectedFilter.set(filter);
    this.currentPage.set(0);
    this.loadAppointments();
  }

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(0);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.loadAppointments();
    }, 300);
  }

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

  isOverdue(appt: AppointmentItem): boolean {
    if (!appt.bookingDate) return false;
    const todayStr = new Date().toISOString().split('T')[0];
    return appt.bookingDate < todayStr;
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

  onLogout(): void {
    this.store.onLogout();
    this.router.navigateByUrl('');
  }
}
