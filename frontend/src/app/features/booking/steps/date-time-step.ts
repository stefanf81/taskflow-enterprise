import { Component, computed, inject } from '@angular/core';
import { formatTime12Hour } from '../../../core/time-utils';
import { BookingStore } from '../booking.store';
import { chevronLeftIcon } from '../../../core/ui/icons/chevron-left';
import { chevronRightIcon } from '../../../core/ui/icons/chevron-right';
import { calendarIcon } from '../../../core/ui/icons/calendar';
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
    calendar: calendarIcon,
    chevronLeft: chevronLeftIcon,
    chevronRight: chevronRightIcon,
  };
  protected readonly store = inject(BookingStore);
  protected readonly formatTime12Hour = formatTime12Hour;

  /** "12 Oct - 20 Oct": the days of the current carousel page. */
  protected readonly dayRange = computed(() => {
    const days = this.store.upcomingBookingDays();
    const first = days[0];
    const last = days.at(-1);
    if (!first || !last) return '';
    const label = (d: typeof first) => `${d.dayNum} ${d.monthName}`;
    return first === last ? label(first) : `${label(first)} \u2013 ${label(last)}`;
  });

  constructor() {
    // Back on this step: show the carousel page of the day already chosen, not the first one.
    this.store.showDayPageOf(this.store.bookingDate());
  }
}
