import { Component, computed, inject, signal } from '@angular/core';
import { finalize, firstValueFrom } from 'rxjs';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { extractApiError } from '../../core/api/extract-api-error';
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
import { AdminStats } from './admin-stats';
import { AppointmentStore } from './appointment.store';
import { ShopClock } from '../../core/shop-clock';
import { formatTime12Hour, formatLocalDate, isOverdue } from '../../core/time-utils';

/** How many approvals a bulk approve has in flight at once. */
const BULK_CONCURRENCY = 4;

/** Owner dashboard · appointments tab (list, filter, search, approve/deny/cancel, bulk approve). */
@Component({
  selector: 'app-admin-appointments-tab',
  imports: [AdminStats, Button, EmptyState, Icon, SegmentedControl, StatusBadge],
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

  /** Ticked bookings. Only ones still pending and on screen count (see `selectedPending`). */
  protected readonly selectedIds = signal<ReadonlySet<number>>(new Set());
  protected readonly isBulkApproving = signal(false);
  protected readonly pendingOnPage = computed(() =>
    this.appointments().filter((appt) => appt.status === 'PENDING'),
  );
  /** The ticked bookings that can still be approved: a refresh may have changed or dropped some. */
  private readonly selectedPending = computed(() => {
    const selected = this.selectedIds();
    return this.pendingOnPage().filter((appt) => selected.has(appt.id));
  });
  protected readonly selectedCount = computed(() => this.selectedPending().length);
  protected readonly someSelected = computed(() => this.selectedCount() > 0);
  protected readonly allPendingSelected = computed(
    () => this.pendingOnPage().length > 0 && this.selectedCount() === this.pendingOnPage().length,
  );
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

  protected toggleSelected(id: number): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected toggleAllPending(): void {
    this.selectedIds.set(
      this.allPendingSelected() ? new Set() : new Set(this.pendingOnPage().map((appt) => appt.id)),
    );
  }

  /**
   * Approves every ticked booking through the per-booking endpoint, a few at a time. Each one
   * succeeds or fails on its own (another request may have taken the slot or changed the
   * status), so one failure never stops the rest; the banner tells how many went through.
   */
  protected approveSelected(): void {
    const targets = this.selectedPending().filter((appt) => !this.pendingIds().has(appt.id));
    if (targets.length === 0 || this.isBulkApproving()) return;
    this.isBulkApproving.set(true);
    targets.forEach((appt) => this.beginAction(appt.id));

    void this.approveAll(targets.map((appt) => appt.id)).then((results) => {
      this.isBulkApproving.set(false);
      const failed = results.filter((result) => result.error !== null);
      const approved = results.length - failed.length;
      // Whatever was ticked is dealt with: approved ones are no longer pending, and a failed
      // one is better ticked again on purpose than retried blindly.
      this.selectedIds.set(new Set());
      this.loadAppointments();
      if (failed.length === 0) {
        this.flash.showSuccess(
          `${approved} ${approved === 1 ? 'appointment' : 'appointments'} APPROVED! Client notification emails queued.`,
        );
      } else if ((failed[0]!.error as { status?: number } | null)?.status !== 401) {
        // The server's reason for the first failure (e.g. "slot already taken") follows the count.
        const reason = extractApiError(failed[0]!.error, 'Please try again.');
        this.flash.errorMessage.set(
          approved === 0
            ? `None of the ${results.length} selected appointments could be approved. ${reason}`
            : `Approved ${approved} of ${results.length}; ${failed.length} could not be approved. ${reason}`,
        );
      }
    });
  }

  /** Approves each id through the per-booking endpoint, `BULK_CONCURRENCY` at a time. */
  private async approveAll(ids: readonly number[]): Promise<{ id: number; error: unknown }[]> {
    const results: { id: number; error: unknown }[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          await firstValueFrom(this.appointmentsApi.updateAppointmentStatus(id, 'APPROVED'));
          results.push({ id, error: null });
        } catch (error) {
          results.push({ id, error });
        } finally {
          this.finishAction(id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, ids.length) }, worker));
    return results;
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
