import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthState } from '../../auth.state';
import { AppointmentStore } from '../../appointment.store';
import { ServiceCatalogStore } from '../../service-catalog.store';
import { AnnouncementBarComponent } from '../../components/announcement-bar/announcement-bar';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal';
import { FaqSectionComponent } from '../../components/faq-section/faq-section';
import { LookbookComponent } from '../../components/lookbook/lookbook';
import { PostBookingActionsComponent } from '../../components/post-booking-actions/post-booking-actions';
import { BookingWizard } from '../booking/booking-wizard';
import { BookingStore } from '../booking/booking.store';

/**
 * Guest landing page (route `/`).
 *
 * Composes the public marketing sections and hosts the booking wizard. Owns
 * only shell-level UI state (login modal + lookbook → wizard hand-off); the
 * booking flow itself lives in {@link BookingStore}.
 */
@Component({
  selector: 'app-landing-page',
  imports: [
    AnnouncementBarComponent,
    AuthModalComponent,
    FaqSectionComponent,
    LookbookComponent,
    PostBookingActionsComponent,
    BookingWizard,
  ],
  templateUrl: './landing-page.html',
})
export class LandingPage {
  private readonly authState = inject(AuthState);
  private readonly bookingStore = inject(BookingStore);
  private readonly appointmentStore = inject(AppointmentStore);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly router = inject(Router);

  readonly isLoggedIn = this.authState.isLoggedIn;
  readonly showAdminLoginModal = signal(false);
  readonly services = this.catalogStore.services;

  constructor() {
    // A signed-in user landing on `/` goes straight to their dashboard.
    effect(() => {
      const role = this.authState.role();
      if (role) {
        this.router.navigateByUrl(this.authState.dashboardPathFor(role));
      }
    });
  }

  selectLookbookStyle(serviceName: string, category: string): void {
    this.bookingStore.selectLookbookStyle(serviceName, category);
  }

  onAuthLoginSuccess(role: string): void {
    this.appointmentStore.showSuccess(
      role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!',
    );
    this.router.navigateByUrl(this.authState.dashboardPathFor(role));
  }
}
