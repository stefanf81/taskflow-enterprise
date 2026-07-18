import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppointmentService, AppointmentItem } from '../../appointment.service';
import { AppointmentStore } from '../../appointment.store';
import { BarberStore } from '../../barber.store';
import { NotificationStore } from '../../notification.store';
import { AuthStore } from '../../auth.store';

type AdminView = 'appointments' | 'services' | 'schedules' | 'notifications';

/**
 * Owner admin dashboard. Lazy-loaded — its code (and the barber/notification
 * stores it pulls in) never enters the initial bundle. Only fetched when the
 * user navigates to /admin.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin.html',
})
export class Admin {
  private readonly appointmentService = inject(AppointmentService);
  private readonly store = inject(AppointmentStore);
  private readonly barberStore = inject(BarberStore);
  private readonly notificationStore = inject(NotificationStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly isLoggedIn = this.auth.isLoggedIn;
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly appointments = this.store.appointments;
  readonly stats = this.store.stats;
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  readonly selectedFilter = this.store.selectedFilter;
  readonly searchQuery = this.store.searchQuery;

  readonly barbersList = this.barberStore.barbers;
  readonly timeOffs = this.barberStore.timeOffs;
  readonly selectedBarberId = this.barberStore.selectedBarberId;
  readonly newTimeOffStartDate = signal('');
  readonly newTimeOffEndDate = signal('');
  readonly newTimeOffReason = signal('');

  readonly notificationsList = this.notificationStore.notifications;

  readonly adminView = signal<AdminView>('appointments');

  setAdminView(view: AdminView): void {
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
    this.barberStore.addTimeOff({
      startDate: this.newTimeOffStartDate(),
      endDate: this.newTimeOffEndDate(),
      reason: this.newTimeOffReason(),
    });
    this.errorMessage.set(null);
    this.newTimeOffStartDate.set('');
    this.newTimeOffEndDate.set('');
    this.newTimeOffReason.set('');
  }

  selectAdminBarber(id: number): void {
    this.barberStore.selectBarber(id);
  }

  onLogout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
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

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(0);
    this.loadAppointments();
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
}
