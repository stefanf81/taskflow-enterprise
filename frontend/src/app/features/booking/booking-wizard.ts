import { Component, inject } from '@angular/core';
import { FormField, FormRoot } from '@angular/forms/signals';
import { formatTime12Hour } from '../../time-utils';
import { ReceiptModalComponent } from '../../components/receipt-modal/receipt-modal';
import { StylistCard } from '../../components/stylist-card/stylist-card';
import { BookingStore } from './booking.store';

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
  readonly isCheckingSlots = this.store.isCheckingSlots;
  readonly isSubmitting = this.store.isSubmitting;
  readonly errorMessage = this.store.errorMessage;
  readonly successMessage = this.store.successMessage;

  readonly showReceiptModal = this.store.showReceiptModal;
  readonly lastBookedAppointment = this.store.lastBookedAppointment;
  readonly checkoutTotal = this.store.checkoutTotal;

  submitBooking(): void {
    this.store.submitBooking();
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
