import { Component, inject, output } from '@angular/core';
import { FormField, FormRoot } from '@angular/forms/signals';
import { formatLocalDate, formatTime12Hour } from '../../../core/time-utils';
import { BookingStore } from '../booking.store';

/**
 * Wizard step 4: contact details, the reservation summary and the submit button.
 *
 * Submitting is the wizard's call (`submitted`): it owns focus management, and a failed submit
 * moves focus to the first invalid field.
 */
@Component({
  selector: 'app-booking-contact-step',
  imports: [FormField, FormRoot],
  templateUrl: './contact-step.html',
  // See ServiceStep: the host only wraps the step's tabpanel.
  host: { class: 'contents' },
})
export class ContactStep {
  protected readonly store = inject(BookingStore);
  protected readonly formatTime12Hour = formatTime12Hour;
  protected readonly formatLocalDate = formatLocalDate;

  /** The booking form was submitted (native submission is already prevented). */
  readonly submitted = output<void>();
}
