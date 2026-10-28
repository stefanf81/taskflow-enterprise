import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppointmentStore } from '../../core/appointments/appointment.store';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { formatTime12Hour, formatLocalDate, isOverdue } from '../../core/time-utils';

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
  protected readonly searchQuery = this.store.searchQuery;
  readonly selectedFilter = this.store.selectedFilter;
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  protected readonly isLoading = this.store.isLoading;
  protected readonly loadErrorMessage = this.store.loadErrorMessage;

  setFilter(filter: string): void {
    this.store.setFilter(filter);
  }

  protected onSearchChange(value: string): void {
    this.store.onSearchChange(value);
  }

  protected nextPage(): void {
    this.store.nextPage();
  }

  protected prevPage(): void {
    this.store.prevPage();
  }

  protected firstPage(): void {
    this.store.setPage(0);
  }

  loadAppointments(): void {
    this.store.refresh();
  }

  approveAppointment(id: number): void {
    this.appointmentsApi.updateAppointmentStatus(id, 'APPROVED').subscribe({
      next: () => {
        this.store.showSuccess('Appointment APPROVED! Client notification email dispatched.');
        this.loadAppointments();
      },
      // 409 = invalid transition / conflict: the server's message says why.
      error: (err) => this.store.reportActionError(err, 'Failed to approve appointment.'),
    });
  }

  denyAppointment(id: number): void {
    this.appointmentsApi.updateAppointmentStatus(id, 'DENIED').subscribe({
      next: () => {
        this.store.showSuccess('Appointment DECLINED. Client notification email dispatched.');
        this.loadAppointments();
      },
      error: (err) => this.store.reportActionError(err, 'Failed to decline appointment.'),
    });
  }

  deleteAppointment(id: number): void {
    if (!confirm('Are you sure you want to permanently delete/cancel this booking?')) return;

    this.appointmentsApi.deleteAppointment(id).subscribe({
      next: () => {
        this.store.showSuccess('Booking permanently deleted.');
        // If this emptied the last page, AppointmentStore steps back by itself.
        this.loadAppointments();
      },
      error: (err) => this.store.reportActionError(err, 'Failed to delete booking.'),
    });
  }

  isOverdue(appt: { bookingDate?: string } | string): boolean {
    return isOverdue(appt);
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  protected formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
