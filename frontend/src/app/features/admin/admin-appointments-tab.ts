import { Component, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { FlashMessages } from '../../core/ui/flash-messages';
import { Button } from '../../core/ui/button';
import { EmptyState } from '../../core/ui/empty-state';
import { Icon } from '../../core/ui/icon';
import { calendarIcon } from '../../core/ui/icons/calendar';
import { mailIcon } from '../../core/ui/icons/mail';
import { phoneIcon } from '../../core/ui/icons/phone';
import { scissorsIcon } from '../../core/ui/icons/scissors';
import { searchIcon } from '../../core/ui/icons/search';
import { xIcon } from '../../core/ui/icons/x';
import { SegmentedControl, SegmentOption } from '../../core/ui/segmented-control';
import { StatusBadge } from '../../core/ui/status-badge';
import { AppointmentStore } from './appointment.store';
import { ShopClock } from '../../core/shop-clock';
import { formatTime12Hour, formatLocalDate, isOverdue } from '../../core/time-utils';

/** Owner dashboard · appointments tab (list, filter, search, approve/deny/cancel). */
@Component({
  selector: 'app-admin-appointments-tab',
  imports: [Button, EmptyState, Icon, SegmentedControl, StatusBadge],
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
  protected readonly filters: readonly SegmentOption<string>[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'denied', label: 'Denied' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  protected readonly icons = {
    calendar: calendarIcon,
    mail: mailIcon,
    phone: phoneIcon,
    scissors: scissorsIcon,
    search: searchIcon,
    x: xIcon,
  };

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
