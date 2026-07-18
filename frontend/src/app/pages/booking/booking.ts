import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppointmentService } from '../../appointment.service';
import { BookingStore } from '../../shared/booking.store';
import { StylistCard } from '../../components/stylist-card/stylist-card';

@Component({
  selector: 'app-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, StylistCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './booking.html',
})
export class Booking {
  private readonly appointmentService = inject(AppointmentService);
  protected readonly booking = inject(BookingStore);

  readonly isSubmitting = this.booking.isSubmitting;
  readonly errorMessage = this.booking.errorMessage;
  readonly successMessage = this.booking.successMessage;

  readonly showReceiptModal = this.booking.showReceiptModal;
  readonly lastBookedAppointment = this.booking.lastBookedAppointment;

  readonly timeSlots = this.booking.timeSlots;
  readonly upcomingBookingDays = this.booking.upcomingBookingDays;
  readonly filteredServices = this.booking.filteredServices;
  readonly stylistProfiles = this.booking.stylistProfiles;
  readonly activeStep = this.booking.activeStep;
  readonly selectedCategory = this.booking.selectedCategory;
  readonly serviceSearchQuery = this.booking.serviceSearchQuery;
  readonly bookingService = this.booking.bookingService;
  readonly bookingBarber = this.booking.bookingBarber;
  readonly bookingDate = this.booking.bookingDate;
  readonly bookingTime = this.booking.bookingTime;
  readonly bookingName = this.booking.bookingName;
  readonly bookingEmail = this.booking.bookingEmail;
  readonly bookingPhone = this.booking.bookingPhone;
  readonly busySlots = this.booking.busySlots;
  readonly selectedServiceObj = this.booking.selectedServiceObj;
  readonly estimatedEndTime = this.booking.estimatedEndTime;
  readonly checkoutSubtotal = this.booking.checkoutSubtotal;
  readonly checkoutFee = this.booking.checkoutFee;
  readonly checkoutTotal = this.booking.checkoutTotal;

  onBookAppointment(): void {
    const name = this.booking.bookingName().trim();
    const email = this.booking.bookingEmail().trim();
    const phone = this.booking.bookingPhone().trim();

    if (!name || !email || !phone || !this.booking.bookingDate()) {
      this.booking.errorMessage.set('Please fill out all required fields to secure your slot.');
      return;
    }

    this.booking.isSubmitting.set(true);
    this.booking.errorMessage.set(null);

    const payload = {
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      barberName: this.booking.bookingBarber(),
      bookingDate: this.booking.bookingDate(),
      bookingTime: this.booking.bookingTime(),
      serviceType: this.booking.bookingService(),
    };

    this.appointmentService.createAppointment(payload).subscribe({
      next: (created) => {
        this.booking.isSubmitting.set(false);
        this.booking.lastBookedAppointment.set(created);
        this.booking.showReceiptModal.set(true);
        this.booking.resetBookingForm();
      },
      error: (err) => {
        this.booking.errorMessage.set(err.error?.message || 'Failed to submit booking request.');
        this.booking.isSubmitting.set(false);
      },
    });
  }

  formatTime12Hour(time: string): string {
    return this.booking.formatTime12Hour(time);
  }
}
