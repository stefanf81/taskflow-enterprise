import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CustomerStore } from '../../customer.store';
import { AppointmentStore } from '../../appointment.store';
import { AuthStore } from '../../auth.store';

@Component({
  selector: 'app-customer',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer.html',
})
export class Customer {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  readonly customerStore = inject(CustomerStore);
  private readonly alerts = inject(AppointmentStore);

  readonly isLoggedIn = this.auth.isLoggedIn;
  readonly errorMessage = this.alerts.errorMessage;
  readonly successMessage = this.alerts.successMessage;
  readonly appointments = this.customerStore.appointments;

  onLogout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }

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
}
