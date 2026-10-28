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
import { FormField, FormRoot } from '@angular/forms/signals';
import { formatTime12Hour } from '../../core/time-utils';
import { ReceiptModalComponent } from './receipt-modal/receipt-modal';
import { StylistCard } from './stylist-card/stylist-card';
import { BookingStore, WIZARD_STEPS } from './booking.store';

/**
 * Presentation shell for the 4-step guest booking wizard.
 *
 * All state lives in {@link BookingStore}; this component only exposes the
 * store's signals to the template and adapts template callbacks.
 */
@Component({
  selector: 'app-booking-wizard',
  imports: [ReceiptModalComponent, StylistCard, FormField, FormRoot],
  templateUrl: './booking-wizard.html',
})
export class BookingWizard {
  private readonly store = inject(BookingStore);
  private readonly injector = inject(Injector);

  /** Stepper tab buttons, in step order (WAI-ARIA tabs: roving focus via arrow keys). */
  private readonly stepTabs = viewChildren<ElementRef<HTMLButtonElement>>('stepTab');

  constructor() {
    // Keep "today" (date carousel, past-slot lock) current while the wizard is on screen:
    // refreshed now, on tab re-focus and at local midnight; torn down with this component.
    this.store.watchToday(inject(DestroyRef));
  }

  readonly bookingModel = this.store.bookingModel;
  protected readonly bookingForm = this.store.bookingForm;
  protected readonly bookingService = this.store.bookingService;
  protected readonly bookingBarber = this.store.bookingBarber;
  protected readonly bookingDate = this.store.bookingDate;
  protected readonly bookingTime = this.store.bookingTime;
  protected readonly activeStep = this.store.activeStep;
  protected readonly selectedCategory = this.store.selectedCategory;
  protected readonly serviceSearchQuery = this.store.serviceSearchQuery;
  protected readonly filteredServices = this.store.filteredServices;
  protected readonly selectedServiceObj = this.store.selectedServiceObj;
  protected readonly stylistProfiles = this.store.stylistProfiles;
  protected readonly upcomingBookingDays = this.store.upcomingBookingDays;
  protected readonly estimatedEndTime = this.store.estimatedEndTime;
  protected readonly formattedBookingDate = this.store.formattedBookingDate;
  protected readonly formattedTotal = this.store.formattedTotal;
  protected readonly timeSlots = this.store.timeSlots;
  readonly noPreferenceLabel = this.store.noPreferenceLabel;

  protected readonly busySlots = this.store.busySlots;
  protected readonly slotsError = this.store.slotsError;
  readonly emailError = this.store.emailError;
  protected readonly catalogError = this.store.catalogError;
  protected readonly catalogLoaded = this.store.catalogLoaded;
  protected readonly rosterError = this.store.rosterError;
  protected readonly isCheckingSlots = this.store.isCheckingSlots;
  protected readonly isSubmitting = this.store.isSubmitting;
  protected readonly errorMessage = this.store.errorMessage;
  protected readonly successMessage = this.store.successMessage;

  protected readonly showReceiptModal = this.store.showReceiptModal;
  protected readonly lastBookedAppointment = this.store.lastBookedAppointment;
  /** Price shown on the receipt: captured when the booking was submitted. */
  protected readonly lastBookedTotal = this.store.lastBookedTotal;

  /** Placeholder rows shown until the catalog arrives; four fill the 380 px scroll area. */
  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly steps = WIZARD_STEPS.map((label, index) => ({ num: index + 1, label }));
  protected readonly activeStepLabel = computed(() => WIZARD_STEPS[this.activeStep() - 1] ?? '');

  // Step 4 field messages only appear once a field was touched (blurred) or a submit was
  // attempted, so a freshly opened form does not fire a burst of role="alert" errors.
  protected readonly nameError = computed(() =>
    this.bookingForm.customerName().touched() && !this.bookingModel().customerName.trim()
      ? 'Full name is required.'
      : null,
  );
  protected readonly visibleEmailError = computed(() =>
    this.bookingForm.customerEmail().touched() ? this.emailError() : null,
  );
  protected readonly phoneError = computed(() =>
    this.bookingForm.customerPhone().touched() && !this.bookingModel().customerPhone.trim()
      ? 'Phone number is required.'
      : null,
  );

  protected submitBooking(): void {
    // A submit attempt reveals the message of every contact field, touched or not.
    this.bookingForm.customerName().markAsTouched();
    this.bookingForm.customerEmail().markAsTouched();
    this.bookingForm.customerPhone().markAsTouched();
    this.store.submitBooking();
    this.focusFirstInvalidField();
  }

  /** Moves focus to the first contact field with a message, once its message is rendered. */
  private focusFirstInvalidField(): void {
    if (this.activeStep() !== 4) return;
    const invalid = [
      { error: this.nameError(), field: this.bookingForm.customerName },
      { error: this.visibleEmailError(), field: this.bookingForm.customerEmail },
      { error: this.phoneError(), field: this.bookingForm.customerPhone },
    ].find((candidate) => candidate.error !== null);
    if (!invalid) return;
    afterNextRender(() => invalid.field().focusBoundControl(), { injector: this.injector });
  }

  /** Accessible name of a step tab: its visible content is only a number or a check mark. */
  protected stepTabLabel(step: number): string {
    const label = `Step ${step} of ${WIZARD_STEPS.length}: ${WIZARD_STEPS[step - 1] ?? ''}`;
    return this.activeStep() > step ? `${label}, completed` : label;
  }

  protected isStepReachable(step: number): boolean {
    return this.store.isStepReachable(step);
  }

  /**
   * WAI-ARIA APG tabs keyboard model with MANUAL activation: ArrowLeft/ArrowRight (wrapping),
   * Home and End only move focus between the step tabs; Enter/Space (the button's native
   * click) activate the focused step, which {@link setStep} refuses for a gated step.
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

  protected isSlotUnavailable(slot: string): boolean {
    return this.store.isSlotUnavailable(slot);
  }

  protected isSlotPast(slot: string): boolean {
    return this.store.isSlotPast(slot);
  }

  protected retrySlots(): void {
    this.store.onBarberOrDateChange();
  }

  protected retryCatalog(): void {
    this.store.retryCatalog();
  }

  protected retryRoster(): void {
    this.store.retryRoster();
  }

  protected isStepValid(step: number): boolean {
    return this.store.isStepValid(step);
  }

  protected setStep(step: number): void {
    this.store.setStep(step);
  }

  protected goToNextStep(): void {
    this.store.goToNextStep();
  }

  protected goToPrevStep(): void {
    this.store.goToPrevStep();
  }

  protected selectService(name: string): void {
    this.store.selectService(name);
  }

  protected selectStylist(name: string): void {
    this.store.selectStylist(name);
  }

  protected setServiceCategory(category: string): void {
    this.store.setServiceCategory(category);
  }

  protected selectBookingDate(dateStr: string): void {
    this.store.selectBookingDate(dateStr);
  }

  protected selectTimeSlot(slot: string): void {
    this.store.selectTimeSlot(slot);
  }

  protected formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }
}
