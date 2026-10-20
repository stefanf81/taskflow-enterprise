import { Component, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BookingWizard } from '../booking/booking-wizard';
import { BookingStore } from '../booking/booking.store';

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
  imports: [BookingWizard, RouterLink],
  template: `
    <div class="w-full px-4 sm:px-8 lg:px-16 pt-12 pb-24 animate-fadeIn">
      <header class="flex justify-between items-center mb-10 pb-6 border-b border-white/10">
        <div class="flex items-center gap-3">
          <span class="text-3xl">✂️</span>
          <div>
            <h1 class="text-xl font-extrabold text-white uppercase leading-none">
              Book an Appointment
            </h1>
            <p class="text-xs text-zinc-500 mt-1.5 font-light">
              Pick a treatment, stylist and time. Your details are pre-filled.
            </p>
          </div>
        </div>
        <a
          routerLink="/customer"
          class="btn btn-secondary py-2.5 px-4 rounded-xl text-xs font-semibold"
        >
          &larr; My Appointments
        </a>
      </header>
      <div class="max-w-3xl mx-auto">
        <app-booking-wizard />
      </div>
    </div>
  `,
})
export class CustomerBooking {
  private readonly store = inject(BookingStore);

  constructor() {
    // Re-runs when the session principal or the customer's booking history arrives, so
    // name/phone fill in once known. Only empty fields are ever filled.
    effect(() => this.store.prefillFromSession());
  }
}
