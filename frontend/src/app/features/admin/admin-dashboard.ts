import { Component, ChangeDetectionStrategy, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AppointmentStore } from '../../appointment.store';
import { AdminEventsService } from '../../admin-events.service';
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
@Component({
  selector: 'app-admin-dashboard',
  imports: [
    CommonModule,
    AdminAppointmentsTab,
    AdminServicesTab,
    AdminSchedulesTab,
    AdminNotificationsTab,
  ],
  templateUrl: './admin-dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard {
  private readonly store = inject(AppointmentStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly adminEvents = inject(AdminEventsService);

  readonly stats = this.store.stats;
  readonly loadErrorMessage = this.store.loadErrorMessage;
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>(
    'appointments',
  );

  constructor() {
    // Every event, and every catch-up after the stream reconnects, refetches the list.
    // store.refresh() restarts a load already in flight instead of dropping the update.
    this.adminEvents.appointmentChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.store.refresh());
    this.adminEvents.connect();
    this.destroyRef.onDestroy(() => this.adminEvents.close());
  }

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
    this.adminView.set(view);
  }

  loadAppointments(): void {
    this.store.loadAppointments(this.store.selectedFilter(), this.store.searchQuery());
  }

  retryLoad(): void {
    this.store.refresh();
  }

  /** Navigates away only once the server confirmed the sign-out; on failure the error banner shows. */
  async onLogout(): Promise<void> {
    if (await this.store.onLogout()) {
      await this.router.navigateByUrl('');
    }
  }
}
