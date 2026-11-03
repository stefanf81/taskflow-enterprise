import { Component, inject } from '@angular/core';
import { formatTime12Hour } from '../../../core/time-utils';
import { BookingStore } from '../booking.store';

/** Wizard step 3: a day from the date carousel and a free slot of that day. */
@Component({
  selector: 'app-booking-date-time-step',
  templateUrl: './date-time-step.html',
  // See ServiceStep: the host only wraps the step's tabpanel.
  host: { class: 'contents' },
})
export class DateTimeStep {
  protected readonly store = inject(BookingStore);
  protected readonly formatTime12Hour = formatTime12Hour;
}
