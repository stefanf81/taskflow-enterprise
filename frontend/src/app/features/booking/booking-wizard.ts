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
import { formatTime12Hour } from '../../time-utils';
import { ReceiptModalComponent } from '../../components/receipt-modal/receipt-modal';
import { StylistCard } from '../../components/stylist-card/stylist-card';
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
  readonly bookingForm = this.store.bookingForm;
  readonly bookingService = this.store.bookingService;
  readonly bookingBarber = this.store.bookingBarber;
  readonly bookingDate = this.store.bookingDate;
  readonly bookingTime = this.store.bookingTime;
  readonly activeStep = this.store.activeStep;
  readonly selectedCategory = this.store.selectedCategory;
  readonly serviceSearchQuery = this.store.serviceSearchQuery;
  readonly filteredServices = this.store.filteredServices;
  readonly selectedServiceObj = this.store.selectedServiceObj;
  readonly stylistProfiles = this.store.stylistProfiles;
  readonly upcomingBookingDays = this.store.upcomingBookingDays;
  readonly estimatedEndTime = this.store.estimatedEndTime;
  readonly formattedBookingDate = this.store.formattedBookingDate;
  readonly formattedTotal = this.store.formattedTotal;
  readonly timeSlots = this.store.timeSlots;
  readonly noPreferenceLabel = this.store.noPreferenceLabel;

  readonly busySlots = this.store.busySlots;
  readonly slotsError = this.store.slotsError;
  readonly emailError = this.store.emailError;
  readonly catalogError = this.store.catalogError;
  readonly catalogLoaded = this.store.catalogLoaded;
  readonly rosterError = this.store.rosterError;
  readonly isCheckingSlots = this.store.isCheckingSlots;
  readonly isSubmitting = this.store.isSubmitting;
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly showReceiptModal = this.store.showReceiptModal;
  readonly lastBookedAppointment = this.store.lastBookedAppointment;
  /** Price shown on the receipt: captured when the booking was submitted. */
  readonly lastBookedTotal = this.store.lastBookedTotal;

  /** Placeholder rows shown until the catalog arrives; four fill the 380 px scroll area. */
  readonly skeletonRows = [0, 1, 2, 3];

  readonly steps = WIZARD_STEPS.map((label, index) => ({ num: index + 1, label }));
  readonly activeStepLabel = computed(() => WIZARD_STEPS[this.activeStep() - 1] ?? '');

  // Step 4 field messages only appear once a field was touched (blurred) or a submit was
  // attempted, so a freshly opened form does not fire a burst of role="alert" errors.
  readonly nameError = computed(() =>
    this.bookingForm.customerName().touched() && !this.bookingModel().customerName.trim()
      ? 'Full name is required.'
      : null,
  );
  readonly visibleEmailError = computed(() =>
    this.bookingForm.customerEmail().touched() ? this.emailError() : null,
  );
  readonly phoneError = computed(() =>
    this.bookingForm.customerPhone().touched() && !this.bookingModel().customerPhone.trim()
      ? 'Phone number is required.'
      : null,
  );

  submitBooking(): void {
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
  stepTabLabel(step: number): string {
    const label = `Step ${step} of ${WIZARD_STEPS.length}: ${WIZARD_STEPS[step - 1] ?? ''}`;
    return this.activeStep() > step ? `${label}, completed` : label;
  }

  isStepReachable(step: number): boolean {
    return this.store.isStepReachable(step);
  }

  /**
   * WAI-ARIA APG tabs keyboard model with MANUAL activation: ArrowLeft/ArrowRight (wrapping),
   * Home and End only move focus between the step tabs; Enter/Space (the button's native
   * click) activate the focused step, which {@link setStep} refuses for a gated step.
   */
  onStepKeydown(event: KeyboardEvent, index: number): void {
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

  isSlotUnavailable(slot: string): boolean {
    return this.store.isSlotUnavailable(slot);
  }

  isSlotPast(slot: string): boolean {
    return this.store.isSlotPast(slot);
  }

  retrySlots(): void {
    this.store.onBarberOrDateChange();
  }

  retryCatalog(): void {
    this.store.retryCatalog();
  }

  retryRoster(): void {
    this.store.retryRoster();
  }

  isStepValid(step: number): boolean {
    return this.store.isStepValid(step);
  }

  setStep(step: number): void {
    this.store.setStep(step);
  }

  goToNextStep(): void {
    this.store.goToNextStep();
  }

  goToPrevStep(): void {
    this.store.goToPrevStep();
  }

  selectService(name: string): void {
    this.store.selectService(name);
  }

  selectStylist(name: string): void {
    this.store.selectStylist(name);
  }

  setServiceCategory(category: string): void {
    this.store.setServiceCategory(category);
  }

  selectBookingDate(dateStr: string): void {
    this.store.selectBookingDate(dateStr);
  }

  selectTimeSlot(slot: string): void {
    this.store.selectTimeSlot(slot);
  }

  formatTime12Hour(time24: string): string {
    return formatTime12Hour(time24);
  }
}
