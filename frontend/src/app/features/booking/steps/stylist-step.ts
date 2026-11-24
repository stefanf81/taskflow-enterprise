import { Component, inject } from '@angular/core';
import { BookingStore } from '../booking.store';
import { StylistCard } from '../stylist-card/stylist-card';
import { shuffleIcon } from '../../../core/ui/icons/shuffle';
import { Icon } from '../../../core/ui/icon';
import { Button } from '../../../core/ui/button';

/** Wizard step 2: a stylist from the public roster, or "No Preference". */
@Component({
  selector: 'app-booking-stylist-step',
  imports: [StylistCard, Icon, Button],
  templateUrl: './stylist-step.html',
  // See ServiceStep: the host only wraps the step's tabpanel.
  host: { class: 'contents' },
})
export class StylistStep {
  protected readonly icons = {
    shuffle: shuffleIcon,
  };
  protected readonly store = inject(BookingStore);
}
