import { Component, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BookingWizard } from '../booking/booking-wizard';
import { BookingStore } from '../booking/booking.store';
import { Button } from '../../core/ui/button';
import { scissorsIcon } from '../../core/ui/icons/scissors';
import { PageHeader } from '../../core/ui/page-header';

/**
 * Signed-in customers' entry to the booking flow (route: `/customer/book`).
 *
 * Hosts the same {@link BookingWizard} the landing page uses (all state lives in
 * the shared {@link BookingStore}), pre-filled with the customer's own contact
 * details. It sits under `/customer` so the existing auth guard keeps it
 * customer-only (an admin deep-linking here is sent to `/admin`).
 */
@Component({
  selector: 'app-customer-booking',
  imports: [BookingWizard, RouterLink, Button, PageHeader],
  template: `
    <div class="w-full px-4 sm:px-8 lg:px-16 pt-12 pb-24">
      <app-page-header
        [icon]="scissorsIcon"
        title="Book an Appointment"
        subtitle="Pick a treatment, stylist and time. Your details are pre-filled."
      >
        <a routerLink="/customer" appButton="secondary">&larr; My Appointments</a>
      </app-page-header>
      <div class="max-w-6xl mx-auto">
        <app-booking-wizard />
      </div>
    </div>
  `,
})
export class CustomerBooking {
  private readonly store = inject(BookingStore);
  protected readonly scissorsIcon = scissorsIcon;

  constructor() {
    // Re-runs when the session principal or the customer's booking history arrives, so
    // name/phone fill in once known. Only empty fields are ever filled.
    effect(() => this.store.prefillFromSession());
  }
}
