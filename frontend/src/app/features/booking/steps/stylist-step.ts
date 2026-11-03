import { Component, inject } from '@angular/core';
import { BookingStore } from '../booking.store';
import { StylistCard } from '../stylist-card/stylist-card';

/** Wizard step 2: a stylist from the public roster, or "No Preference". */
@Component({
  selector: 'app-booking-stylist-step',
  imports: [StylistCard],
  templateUrl: './stylist-step.html',
  // See ServiceStep: the host only wraps the step's tabpanel.
  host: { class: 'contents' },
})
export class StylistStep {
  protected readonly store = inject(BookingStore);
}
