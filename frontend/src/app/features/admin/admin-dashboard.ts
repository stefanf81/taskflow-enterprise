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
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>(
    'appointments',
  );

  constructor() {
    this.adminEvents.appointmentChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.store.loadAppointments());
    this.adminEvents.connect();
    this.destroyRef.onDestroy(() => this.adminEvents.close());
  }

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
    this.adminView.set(view);
  }

  loadAppointments(): void {
    this.store.loadAppointments(this.store.selectedFilter(), this.store.searchQuery());
  }

  onLogout(): void {
    this.store.onLogout();
    this.router.navigateByUrl('');
  }
}
