import { Component, inject } from '@angular/core';
import { formatUsd } from '../../../core/format';
import { BookingStore } from '../booking.store';
import { circleCheckIcon } from '../../../core/ui/icons/circle-check';
import { searchIcon } from '../../../core/ui/icons/search';
import { timerIcon } from '../../../core/ui/icons/timer';
import { Icon } from '../../../core/ui/icon';
import { Button } from '../../../core/ui/button';
import { SegmentedControl, SegmentOption } from '../../../core/ui/segmented-control';

/** Wizard step 1: search and filter the catalog, pick a treatment. */
@Component({
  selector: 'app-booking-service-step',
  imports: [Icon, Button, SegmentedControl],
  templateUrl: './service-step.html',
  // The host only wraps the step's tabpanel: no box of its own, so the wizard lays the panel out
  // exactly as when it was inline.
  host: { class: 'contents' },
})
export class ServiceStep {
  protected readonly icons = {
    circleCheck: circleCheckIcon,
    search: searchIcon,
    timer: timerIcon,
  };
  protected readonly store = inject(BookingStore);
  protected readonly formatUsd = formatUsd;

  protected readonly categories: readonly SegmentOption<string>[] = [
    { value: 'all', label: 'All' },
    { value: 'hair', label: 'Hair' },
    { value: 'beard', label: 'Beards' },
    { value: 'combo', label: 'Combos' },
  ];

  /** Placeholder rows shown until the catalog arrives; four fill the 380 px scroll area. */
  protected readonly skeletonRows = [0, 1, 2, 3];
}
