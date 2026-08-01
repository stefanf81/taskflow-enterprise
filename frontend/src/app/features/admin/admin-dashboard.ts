import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  inject,
  DestroyRef,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppointmentService, AppointmentItem } from '../../appointment.service';
import { AppointmentStore } from '../../appointment.store';
import { BarberStore } from '../../barber.store';
import { NotificationStore } from '../../notification.store';
import { CustomerStore } from '../../customer.store';
import { ServiceCatalogStore } from '../../service-catalog.store';
import { formatTime12Hour, formatLocalDate, isOverdue } from '../../time-utils';

/**
 * Lazy-loaded Owner dashboard (route: /admin). Extracted from the monolithic
 * App shell so it is no longer part of the initial JS bundle (P1 route-level
 * code splitting). All shared state lives in the injectable singleton stores,
 * which this component re-uses directly.
 */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: '../../app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AdminDashboard {
  private readonly appointmentService = inject(AppointmentService);
  private readonly store = inject(AppointmentStore);
  private readonly barberStore = inject(BarberStore);
  private readonly notificationStore = inject(NotificationStore);
  readonly customerStore = inject(CustomerStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Eager httpResource — services are already loaded at app boot; the tab just reads them. */
  readonly catalogStore = inject(ServiceCatalogStore);

  readonly appointments = this.store.appointments;
  readonly searchQuery = this.store.searchQuery;
  readonly selectedFilter = this.store.selectedFilter;
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  readonly stats = this.store.stats;
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly adminView = signal<'appointments' | 'services' | 'schedules' | 'notifications'>(
    'appointments',
  );
  readonly barbersList = this.barberStore.barbers;
  readonly timeOffs = this.barberStore.timeOffs;
  readonly selectedBarberId = this.barberStore.selectedBarberId;
  readonly timeOffActionError = this.barberStore.actionErrorMessage;
  readonly timeOffActionSuccess = this.barberStore.actionSuccessMessage;
  readonly isSavingTimeOff = this.barberStore.isSaving;
  readonly newTimeOffStartDate = signal('');
  readonly newTimeOffEndDate = signal('');
  readonly newTimeOffReason = signal('');
  readonly notificationsList = this.notificationStore.notifications;

  setAdminView(view: 'appointments' | 'services' | 'schedules' | 'notifications'): void {
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
    // Clear any stale alert before the async write.
    this.successMessage.set(null);
    this.barberStore.addTimeOff({
      startDate: this.newTimeOffStartDate(),
      endDate: this.newTimeOffEndDate(),
      reason: this.newTimeOffReason(),
    });
    this.newTimeOffStartDate.set('');
    this.newTimeOffEndDate.set('');
    this.newTimeOffReason.set('');
  }

  selectAdminBarber(id: number): void {
    this.barberStore.selectBarber(id);
  }

  loadAppointments(): void {
    this.store.loadAppointments(this.selectedFilter(), this.searchQuery());
  }

  approveAppointment(id: number): void {
    this.appointmentService
      .updateAppointmentStatus(id, 'APPROVED')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.successMessage.set('Appointment APPROVED! Client notification email dispatched.');
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to approve appointment.'),
      });
  }

  denyAppointment(id: number): void {
    this.appointmentService
      .updateAppointmentStatus(id, 'DENIED')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.successMessage.set('Appointment DECLINED. Client notification email dispatched.');
          this.loadAppointments();
        },
        error: () => this.errorMessage.set('Failed to decline appointment.'),
      });
  }

  deleteAppointment(id: number): void {
    if (confirm('Are you sure you want to permanently delete/cancel this booking?')) {
      this.appointmentService
        .deleteAppointment(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
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

  // Filter / search / pagination delegate straight to the store: the
  // httpResource refetches reactively when the signals it reads change, so any
  // extra reload() here would fire a duplicate request per action (B1). Search
  // debouncing also lives in the store.
  setFilter(filter: string): void {
    this.store.setFilter(filter);
  }

  onSearchChange(value: string): void {
    this.store.onSearchChange(value);
  }

  setPage(page: number): void {
    this.store.setPage(page);
  }

  nextPage(): void {
    this.store.nextPage();
  }

  prevPage(): void {
    this.store.prevPage();
  }

  isOverdue(appt: AppointmentItem): boolean {
    return isOverdue(appt);
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }

  onLogout(): void {
    this.store.onLogout();
    this.router.navigateByUrl('');
  }
}
