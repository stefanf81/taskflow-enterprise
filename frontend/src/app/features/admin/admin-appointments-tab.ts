import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppointmentStore } from '../../appointment.store';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { formatTime12Hour, formatLocalDate, isOverdue } from '../../time-utils';

/** Owner dashboard · appointments tab (list, filter, search, approve/deny/delete). */
@Component({
  selector: 'app-admin-appointments-tab',
  imports: [CommonModule],
  templateUrl: './admin-appointments-tab.html',
})
export class AdminAppointmentsTab {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly store = inject(AppointmentStore);

  readonly appointments = this.store.appointments;
  readonly searchQuery = this.store.searchQuery;
  readonly selectedFilter = this.store.selectedFilter;
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;

  setFilter(filter: string): void {
    this.store.setFilter(filter);
  }

  onSearchChange(value: string): void {
    this.store.onSearchChange(value);
  }

  nextPage(): void {
    this.store.nextPage();
  }

  prevPage(): void {
    this.store.prevPage();
  }

  loadAppointments(): void {
    this.store.loadAppointments();
  }

  approveAppointment(id: number): void {
    this.appointmentsApi.updateAppointmentStatus(id, 'APPROVED').subscribe({
      next: () => {
        this.store.showSuccess('Appointment APPROVED! Client notification email dispatched.');
        this.loadAppointments();
      },
      error: () => this.store.errorMessage.set('Failed to approve appointment.'),
    });
  }

  denyAppointment(id: number): void {
    this.appointmentsApi.updateAppointmentStatus(id, 'DENIED').subscribe({
      next: () => {
        this.store.showSuccess('Appointment DECLINED. Client notification email dispatched.');
        this.loadAppointments();
      },
      error: () => this.store.errorMessage.set('Failed to decline appointment.'),
    });
  }

  deleteAppointment(id: number): void {
    if (!confirm('Are you sure you want to permanently delete/cancel this booking?')) return;

    this.appointmentsApi.deleteAppointment(id).subscribe({
      next: () => {
        this.store.showSuccess('Booking permanently deleted.');
        if (this.appointments().length === 1 && this.currentPage() > 0) {
          this.currentPage.update((p) => p - 1);
        }
        this.loadAppointments();
      },
      error: () => this.store.errorMessage.set('Failed to delete booking.'),
    });
  }

  isOverdue(appt: { bookingDate?: string } | string): boolean {
    return isOverdue(appt);
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
