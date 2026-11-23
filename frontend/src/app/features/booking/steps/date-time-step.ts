import { Component, inject } from '@angular/core';
import { formatTime12Hour } from '../../../core/time-utils';
import { BookingStore } from '../booking.store';
import { banIcon } from '../../../core/ui/icons/ban';
import { calendarIcon } from '../../../core/ui/icons/calendar';
import { timerIcon } from '../../../core/ui/icons/timer';
import { Icon } from '../../../core/ui/icon';
import { Button } from '../../../core/ui/button';
import { Alert } from '../../../core/ui/alert';

/** Wizard step 3: a day from the date carousel and a free slot of that day. */
@Component({
  selector: 'app-booking-date-time-step',
  imports: [Icon, Button, Alert],
  templateUrl: './date-time-step.html',
  // See ServiceStep: the host only wraps the step's tabpanel.
  host: { class: 'contents' },
})
export class DateTimeStep {
  protected readonly icons = {
    ban: banIcon,
    calendar: calendarIcon,
    timer: timerIcon,
  };
  protected readonly store = inject(BookingStore);
  protected readonly formatTime12Hour = formatTime12Hour;
}
