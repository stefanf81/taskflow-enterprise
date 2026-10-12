import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AppointmentStore } from '../../appointment.store';
import { isCustomerCancellable, statusLabel } from '../../appointment-status';
import { CustomerStore } from '../../customer.store';
import { formatTime12Hour, formatLocalDate } from '../../time-utils';

/**
 * Lazy-loaded Customer dashboard (route: /customer). Extracted from the monolithic
 * App shell so it is no longer part of the initial JS bundle (P1 route-level
 * code splitting). Shares the singleton AppointmentStore/CustomerStore.
 */
@Component({
  selector: 'app-customer-portal',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './customer-portal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerPortal {
  private readonly store = inject(AppointmentStore);
  readonly customerStore = inject(CustomerStore);
  private readonly router = inject(Router);

  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;
  readonly cancelErrorMessage = this.customerStore.cancelErrorMessage;
  readonly isLoading = this.customerStore.isLoading;
  readonly loadErrorMessage = this.customerStore.loadErrorMessage;
  readonly currentPage = this.customerStore.currentPage;
  readonly totalPages = this.customerStore.totalPages;

  loadAppointments(): void {
    this.customerStore.loadAppointments();
  }

  nextPage(): void {
    this.customerStore.nextPage();
  }

  prevPage(): void {
    this.customerStore.prevPage();
  }

  statusLabel(status: string): string {
    return statusLabel(status);
  }

  /** Cancelled and denied bookings are final: no Cancel button. */
  isCancellable(status: string): boolean {
    return isCustomerCancellable(status);
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }

  /** Navigates away only once the server confirmed the sign-out; on failure the error banner shows. */
  async onLogout(): Promise<void> {
    if (await this.store.onLogout()) {
      await this.router.navigateByUrl('');
    }
  }
}
