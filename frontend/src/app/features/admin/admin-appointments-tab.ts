import { Component, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { FlashMessages } from '../../core/ui/flash-messages';
import { AppointmentStore } from './appointment.store';
import { ShopClock } from '../../core/shop-clock';
import { formatTime12Hour, formatLocalDate, isOverdue } from '../../core/time-utils';

/** Owner dashboard · appointments tab (list, filter, search, approve/deny/cancel). */
@Component({
  selector: 'app-admin-appointments-tab',
  imports: [],
  templateUrl: './admin-appointments-tab.html',
})
export class AdminAppointmentsTab {
  private readonly appointmentsApi = inject(AppointmentsApi);
  private readonly store = inject(AppointmentStore);
  private readonly flash = inject(FlashMessages);
  private readonly shopClock = inject(ShopClock);

  readonly appointments = this.store.appointments;
  protected readonly searchQuery = this.store.searchQuery;
  readonly selectedFilter = this.store.selectedFilter;
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  protected readonly isLoading = this.store.isLoading;
  protected readonly loadErrorMessage = this.store.loadErrorMessage;
  protected readonly pendingIds = signal<ReadonlySet<number>>(new Set());

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
    if (!this.beginAction(id)) return;
    this.appointmentsApi
      .updateAppointmentStatus(id, 'APPROVED')
      .pipe(finalize(() => this.finishAction(id)))
      .subscribe({
        next: () => {
          this.flash.showSuccess('Appointment APPROVED! Client notification email queued.');
          this.loadAppointments();
        },
        // 409 = invalid transition / conflict: the server's message says why.
        error: (err) => this.flash.reportActionError(err, 'Failed to approve appointment.'),
      });
  }

  denyAppointment(id: number): void {
    if (!this.beginAction(id)) return;
    this.appointmentsApi
      .updateAppointmentStatus(id, 'DENIED')
      .pipe(finalize(() => this.finishAction(id)))
      .subscribe({
        next: () => {
          this.flash.showSuccess('Appointment DECLINED. Client notification email queued.');
          this.loadAppointments();
        },
        error: (err) => this.flash.reportActionError(err, 'Failed to decline appointment.'),
      });
  }

  cancelAppointment(id: number): void {
    const appointment = this.appointments().find((item) => item.id === id);
    if (
      this.pendingIds().has(id) ||
      (appointment?.status !== 'PENDING' && appointment?.status !== 'APPROVED')
    ) {
      return;
    }
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    if (!this.beginAction(id)) return;

    this.appointmentsApi
      .deleteAppointment(id)
      .pipe(finalize(() => this.finishAction(id)))
      .subscribe({
        next: () => {
          this.flash.showSuccess('Booking cancelled.');
          // If this emptied the last page, AppointmentStore steps back by itself.
          this.loadAppointments();
        },
        error: (err) => this.flash.reportActionError(err, 'Failed to cancel booking.'),
      });
  }

  private beginAction(id: number): boolean {
    if (this.pendingIds().has(id)) return false;
    this.pendingIds.update((ids) => new Set([...ids, id]));
    return true;
  }

  private finishAction(id: number): void {
    this.pendingIds.update((ids) => {
      const remaining = new Set(ids);
      remaining.delete(id);
      return remaining;
    });
  }

  isOverdue(appt: { bookingDate?: string } | string): boolean {
    // "Before today" in the shop's calendar, as the server's OVERDUE filter decides it.
    return isOverdue(appt, this.shopClock.now());
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  protected formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
