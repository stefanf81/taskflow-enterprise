import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChildren,
} from '@angular/core';
import { FlashMessages } from '../../core/ui/flash-messages';
import { ReceiptModalComponent } from './receipt-modal/receipt-modal';
import { ContactStep } from './steps/contact-step';
import { DateTimeStep } from './steps/date-time-step';
import { ServiceStep } from './steps/service-step';
import { StylistStep } from './steps/stylist-step';
import { BookingStore, WIZARD_STEPS } from './booking.store';

/** Progress bar width per step (Tailwind classes, written out so the class scanner finds them). */
const STEP_PROGRESS_WIDTHS = ['w-0', 'w-1/3', 'w-2/3', 'w-full'] as const;

/**
 * Shell of the 4-step guest booking wizard: the stepper, the app-wide banner, the footer
 * navigation and the receipt.
 *
 * Each step is its own component reading {@link BookingStore} directly. The shell keeps what
 * spans the steps: the WAI-ARIA tabs stepper with its roving focus, and moving focus to the first
 * invalid contact field after a failed submit.
 */
@Component({
  selector: 'app-booking-wizard',
  imports: [ReceiptModalComponent, ServiceStep, StylistStep, DateTimeStep, ContactStep],
  templateUrl: './booking-wizard.html',
})
export class BookingWizard {
  protected readonly store = inject(BookingStore);
  protected readonly flash = inject(FlashMessages);
  private readonly injector = inject(Injector);

  /** Stepper tab buttons, in step order (WAI-ARIA tabs: roving focus via arrow keys). */
  private readonly stepTabs = viewChildren<ElementRef<HTMLButtonElement>>('stepTab');

  protected readonly steps = WIZARD_STEPS.map((label, index) => ({ num: index + 1, label }));
  /**
   * Width of the step progress bar as a class: a `[style.width.%]` binding is written into the
   * prerendered HTML as a `style` attribute, which the CSP (`style-src 'self'`) refuses.
   */
  protected readonly progressWidthClass = computed(
    () => STEP_PROGRESS_WIDTHS[this.store.activeStep() - 1] ?? 'w-0',
  );
  protected readonly activeStepLabel = computed(
    () => WIZARD_STEPS[this.store.activeStep() - 1] ?? '',
  );

  constructor() {
    // Keep "today" (date carousel, past-slot lock) current while the wizard is on screen:
    // refreshed now, on tab re-focus and at local midnight; torn down with this component.
    this.store.watchToday(inject(DestroyRef));
  }

  /** Step 4's submit: a failed attempt reveals every field message and focuses the first. */
  protected submitBooking(): void {
    this.store.submitBooking();
    this.focusFirstInvalidField();
  }

  /** Moves focus to the first contact field with a message, once its message is rendered. */
  private focusFirstInvalidField(): void {
    if (this.store.activeStep() !== 4) return;
    const form = this.store.bookingForm;
    const invalid = [
      { error: this.store.nameError(), field: form.customerName },
      { error: this.store.visibleEmailError(), field: form.customerEmail },
      { error: this.store.phoneError(), field: form.customerPhone },
    ].find((candidate) => candidate.error !== null);
    if (!invalid) return;
    afterNextRender(() => invalid.field().focusBoundControl(), { injector: this.injector });
  }

  /** Accessible name of a step tab: its visible content is only a number or a check mark. */
  protected stepTabLabel(step: number): string {
    const label = `Step ${step} of ${WIZARD_STEPS.length}: ${WIZARD_STEPS[step - 1] ?? ''}`;
    return this.store.activeStep() > step ? `${label}, completed` : label;
  }

  /**
   * WAI-ARIA APG tabs keyboard model with MANUAL activation: ArrowLeft/ArrowRight (wrapping),
   * Home and End only move focus between the step tabs; Enter/Space (the button's native
   * click) activate the focused step, which `BookingStore.setStep` refuses for a gated step.
   */
  protected onStepKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.stepTabs();
    const last = tabs.length - 1;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = index >= last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        target = index <= 0 ? last : index - 1;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabs[target]?.nativeElement.focus();
  }
}
