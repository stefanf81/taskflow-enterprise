import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { injectSignOut } from '../../core/auth/sign-out';
import { CustomerStore } from '../../core/customer/customer.store';
import { FlashMessages } from '../../core/ui/flash-messages';
import { isCustomerCancellable } from '@taskflow/domain';
import { ShopClock } from '../../core/shop-clock';
import { statusLabel } from './appointment-status';
import { formatTime12Hour, formatLocalDate } from '../../core/time-utils';

/**
 * Lazy-loaded Customer dashboard (route: /customer). Extracted from the monolithic
 * App shell so it is no longer part of the initial JS bundle (P1 route-level
 * code splitting). Its list lives in CustomerStore; action messages use the app-wide banner
 * (FlashMessages).
 */
@Component({
  selector: 'app-customer-portal',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './customer-portal.html',
})
export class CustomerPortal {
  private readonly flash = inject(FlashMessages);
  private readonly signOut = injectSignOut();
  readonly customerStore = inject(CustomerStore);
  private readonly shopClock = inject(ShopClock);
  private readonly router = inject(Router);

  readonly errorMessage = this.flash.errorMessage;
  protected readonly successMessage = this.flash.successMessage;
  readonly cancelErrorMessage = this.customerStore.cancelErrorMessage;
  protected readonly isLoading = this.customerStore.isLoading;
  protected readonly loadErrorMessage = this.customerStore.loadErrorMessage;
  protected readonly currentPage = this.customerStore.currentPage;
  protected readonly totalPages = this.customerStore.totalPages;

  protected loadAppointments(): void {
    this.customerStore.loadAppointments();
  }

  protected nextPage(): void {
    this.customerStore.nextPage();
  }

  protected prevPage(): void {
    this.customerStore.prevPage();
  }

  protected statusLabel(status: string): string {
    return statusLabel(status);
  }

  /**
   * Only an upcoming PENDING or APPROVED booking gets a Cancel button, the rule the server applies
   * (denied and cancelled bookings are final; one that has started can no longer be cancelled).
   */
  protected isCancellable(appt: {
    status: string;
    bookingDate: string;
    bookingTime: string;
  }): boolean {
    return isCustomerCancellable(appt, this.shopClock.now());
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }

  protected formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }

  /** Navigates away only once the server confirmed the sign-out; on failure the error banner shows. */
  async onLogout(): Promise<void> {
    if (await this.signOut()) {
      await this.router.navigateByUrl('');
    }
  }
}
