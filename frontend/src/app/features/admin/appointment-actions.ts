import { Injectable, inject, signal } from '@angular/core';
import { Subject, finalize, firstValueFrom } from 'rxjs';
import { AppointmentsApi } from '../../core/api/appointments-api';
import { FlashMessages } from '../../core/ui/flash-messages';
import { AppointmentStore } from './appointment.store';

/** How many approvals a bulk approve has in flight at once. */
const BULK_CONCURRENCY = 4;

/** The part of a booking an action needs. */
export interface ActionTarget {
  id: number;
  status: string;
}

/**
 * What the owner can do to a booking: approve, deny, cancel, or approve many. Shared by the
 * appointment list and the calendar, so both show the same banners, lock a booking while its
 * request is in flight (a double click sends one request), and refresh the list afterwards.
 * {@link changed} tells a view that keeps its own copy (the calendar) to reload.
 */
@Injectable({ providedIn: 'root' })
export class AppointmentActions {
  private readonly api = inject(AppointmentsApi);
  private readonly store = inject(AppointmentStore);
  private readonly flash = inject(FlashMessages);
  private readonly changedSubject = new Subject<void>();

  /** Bookings with a request in flight. */
  readonly pendingIds = signal<ReadonlySet<number>>(new Set());
  /** Emits after any booking was changed by an action here. */
  readonly changed = this.changedSubject.asObservable();

  approve(id: number): void {
    if (!this.lock(id)) return;
    this.api
      .updateAppointmentStatus(id, 'APPROVED')
      .pipe(finalize(() => this.unlock(id)))
      .subscribe({
        next: () => {
          this.flash.showSuccess('Appointment APPROVED! Client notification email queued.');
          this.reload();
        },
        // 409 = invalid transition / conflict: the server's message says why.
        error: (err) => this.flash.reportActionError(err, 'Failed to approve appointment.'),
      });
  }

  deny(id: number): void {
    if (!this.lock(id)) return;
    this.api
      .updateAppointmentStatus(id, 'DENIED')
      .pipe(finalize(() => this.unlock(id)))
      .subscribe({
        next: () => {
          this.flash.showSuccess('Appointment DECLINED. Client notification email queued.');
          this.reload();
        },
        error: (err) => this.flash.reportActionError(err, 'Failed to decline appointment.'),
      });
  }

  /** Cancels a pending or approved booking after the owner confirms. */
  cancel(appointment: ActionTarget): void {
    if (
      this.pendingIds().has(appointment.id) ||
      (appointment.status !== 'PENDING' && appointment.status !== 'APPROVED')
    ) {
      return;
    }
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    if (!this.lock(appointment.id)) return;

    this.api
      .deleteAppointment(appointment.id)
      .pipe(finalize(() => this.unlock(appointment.id)))
      .subscribe({
        next: () => {
          this.flash.showSuccess('Booking cancelled.');
          // If this emptied the last page, AppointmentStore steps back by itself.
          this.reload();
        },
        error: (err) => this.flash.reportActionError(err, 'Failed to cancel booking.'),
      });
  }

  /**
   * Approves each booking through the per-booking endpoint, `BULK_CONCURRENCY` at a time. Each one
   * succeeds or fails on its own (another request may have taken the slot or changed the status),
   * so one failure never stops the rest. Bookings already in flight are skipped. The caller
   * reports the outcome.
   */
  async approveMany(ids: readonly number[]): Promise<{ id: number; error: unknown }[]> {
    const targets = ids.filter((id) => this.lock(id));
    const results: { id: number; error: unknown }[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < targets.length) {
        const id = targets[next++]!;
        try {
          await firstValueFrom(this.api.updateAppointmentStatus(id, 'APPROVED'));
          results.push({ id, error: null });
        } catch (error) {
          results.push({ id, error });
        } finally {
          this.unlock(id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, targets.length) }, worker));
    if (results.length > 0) this.reload();
    return results;
  }

  private reload(): void {
    this.store.refresh();
    this.changedSubject.next();
  }

  private lock(id: number): boolean {
    if (this.pendingIds().has(id)) return false;
    this.pendingIds.update((ids) => new Set([...ids, id]));
    return true;
  }

  private unlock(id: number): void {
    this.pendingIds.update((ids) => {
      const remaining = new Set(ids);
      remaining.delete(id);
      return remaining;
    });
  }
}
