import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppointmentService } from '../../appointment.service';
import { BookingStore } from '../../shared/booking.store';
import { Faq } from '../faq/faq';
import { ReviewPortal } from '../reviews/review-portal';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, Faq, ReviewPortal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
})
export class Home implements OnInit {
  private readonly appointmentService = inject(AppointmentService);
  private readonly booking = inject(BookingStore);
  private readonly router = inject(Router);

  readonly services = this.booking.services;
  readonly serviceSearchQuery = this.booking.serviceSearchQuery;
  readonly selectedCategory = this.booking.selectedCategory;
  readonly isCheckingSlots = this.booking.isCheckingSlots;

  // Cancellation portal state
  cancelBookingId = '';
  cancelEmail = '';

  // Review portal state
  reviewPublicId = '';
  reviewRating = 5;
  reviewComment = '';

  ngOnInit(): void {
    this.booking.services; // catalog resource already loads on first read
  }

  // --- Lookbook → booking flow ---
  selectLookbookStyle(serviceName: string, category: string): void {
    this.booking.selectLookbookStyle(serviceName, category);
    this.router.navigate(['/booking']);
  }

  // --- Service menu helpers (delegated to BookingStore) ---
  setServiceCategory(cat: string): void {
    this.booking.setServiceCategory(cat);
  }

  // --- Cancellation portal ---
  onPublicCancel(): void {
    const publicId = this.cancelBookingId.trim();
    const email = this.cancelEmail.trim();
    if (!publicId || !email) {
      return;
    }
    this.appointmentService.publicCancelAppointment(publicId, email).subscribe({
      next: () => {
        this.cancelBookingId = '';
        this.cancelEmail = '';
      },
      error: () => {
        // surfaced via alert handled in admin/customer; here silently reset
      },
    });
  }

  // --- Review portal ---
  submitReview(): void {
    if (!this.reviewPublicId.trim()) {
      return;
    }
    this.appointmentService
      .submitReview(this.reviewPublicId.trim(), {
        rating: this.reviewRating,
        comment: this.reviewComment,
      })
      .subscribe({
        next: () => {
          this.reviewPublicId = '';
          this.reviewComment = '';
          this.reviewRating = 5;
        },
      });
  }
}
