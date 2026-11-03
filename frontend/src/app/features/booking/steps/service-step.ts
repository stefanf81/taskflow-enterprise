import { Component, inject } from '@angular/core';
import { BookingStore } from '../booking.store';

/** Wizard step 1: search and filter the catalog, pick a treatment. */
@Component({
  selector: 'app-booking-service-step',
  templateUrl: './service-step.html',
  // The host only wraps the step's tabpanel: no box of its own, so the wizard lays the panel out
  // exactly as when it was inline.
  host: { class: 'contents' },
})
export class ServiceStep {
  protected readonly store = inject(BookingStore);

  protected readonly categories = [
    { id: 'all', label: 'All' },
    { id: 'hair', label: 'Hair' },
    { id: 'beard', label: 'Beards' },
    { id: 'combo', label: 'Combos' },
  ] as const;

  /** Placeholder rows shown until the catalog arrives; four fill the 380 px scroll area. */
  protected readonly skeletonRows = [0, 1, 2, 3];
}
