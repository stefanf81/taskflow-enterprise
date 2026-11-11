import { Component, computed, inject, DestroyRef, signal } from '@angular/core';
import { formatUsd } from '../../core/format';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { asyncScheduler, throttleTime } from 'rxjs';
import { Router } from '@angular/router';
import { injectSignOut } from '../../core/auth/sign-out';
import { FlashMessages } from '../../core/ui/flash-messages';
import { AppointmentStore } from './appointment.store';
import { AdminEventsService } from './admin-events.service';
import { AdminAppointmentsTab } from './admin-appointments-tab';
import { AdminServicesTab } from './admin-services-tab';
import { AdminSchedulesTab } from './admin-schedules-tab';
import { AdminNotificationsTab } from './admin-notifications-tab';

/**
 * Lazy-loaded Owner dashboard shell (route: /admin).
 *
 * Owns the dashboard chrome (stats, alerts, view switch, logout, SSE stream)
 * and delegates each workspace to a dedicated tab component. All shared state
 * lives in the injectable singleton stores.
 */
/** Window in which a burst of appointment events is coalesced into at most two refreshes. */
export const REFRESH_THROTTLE_MS = 300;

@Component({
  selector: 'app-admin-dashboard',
  imports: [AdminAppointmentsTab, AdminServicesTab, AdminSchedulesTab, AdminNotificationsTab],
  templateUrl: './admin-dashboard.html',
})
export class AdminDashboard {
  private readonly store = inject(AppointmentStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly adminEvents = inject(AdminEventsService);
  private readonly flash = inject(FlashMessages);
  private readonly signOut = injectSignOut();

  readonly stats = this.store.stats;
  protected readonly approvedRevenue = computed(() => formatUsd(this.stats().approvedRevenue));
  protected readonly loadErrorMessage = this.store.loadErrorMessage;
  protected readonly errorMessage = this.flash.errorMessage;
  protected readonly successMessage = this.flash.successMessage;

  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>(
    'appointments',
  );

  constructor() {
    // Every event, and every catch-up after the stream reconnects, refetches the list.
    // store.refreshWhenIdle() lets a load already in flight finish and then loads once more, so a
    // steady stream of events never keeps cancelling it. A burst (time off cancelling many
    // bookings sends one event each) is coalesced: the first event refreshes at once, the rest
    // of the burst in one trailing refresh per window.
    this.adminEvents.appointmentChanges
      .pipe(
        throttleTime(REFRESH_THROTTLE_MS, asyncScheduler, { leading: true, trailing: true }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.store.refreshWhenIdle());
    this.adminEvents.connect();
    this.destroyRef.onDestroy(() => this.adminEvents.close());
  }

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
    this.adminView.set(view);
  }

  protected loadAppointments(): void {
    this.store.loadAppointments(this.store.selectedFilter(), this.store.searchQuery());
  }

  retryLoad(): void {
    this.store.refresh();
  }

  /** Navigates away only once the server confirmed the sign-out; on failure the error banner shows. */
  async onLogout(): Promise<void> {
    if (await this.signOut()) {
      await this.router.navigateByUrl('');
    }
  }
}
