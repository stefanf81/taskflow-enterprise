import { Component, ChangeDetectionStrategy, ViewEncapsulation, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AppointmentStore } from '../../appointment.store';
import { CustomerStore } from '../../customer.store';

/**
 * Lazy-loaded Customer dashboard (route: /customer). Extracted from the monolithic
 * App shell so it is no longer part of the initial JS bundle (P1 route-level
 * code splitting). Shares the singleton AppointmentStore/CustomerStore.
 */
@Component({
  selector: 'app-customer-portal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './customer-portal.html',
  styleUrl: '../../app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class CustomerPortal {
  private readonly store = inject(AppointmentStore);
  readonly customerStore = inject(CustomerStore);
  private readonly router = inject(Router);

  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  formatTime12Hour(time24: string): string {
    if (!time24) return '';
    try {
      const parts = time24.split(':');
      let hours = parseInt(parts[0], 10);
      const minutes = parts[1] || '00';
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${hours}:${minutes} ${ampm}`;
    } catch {
      return time24;
    }
  }

  onLogout(): void {
    this.store.onLogout();
    this.router.navigateByUrl('');
  }
}
