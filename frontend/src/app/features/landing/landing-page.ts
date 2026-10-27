import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthState } from '../../auth.state';
import { DashboardPrefetch } from '../../dashboard-loaders';
import { AppointmentStore } from '../../appointment.store';
import { ServiceCatalogStore } from '../../service-catalog.store';
import { AnnouncementBarComponent } from '../../components/announcement-bar/announcement-bar';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal';
import { FaqSectionComponent } from '../../components/faq-section/faq-section';
import { LookbookComponent } from '../../components/lookbook/lookbook';
import { PostBookingActionsComponent } from '../../components/post-booking-actions/post-booking-actions';
import { BookingWizard } from '../booking/booking-wizard';
import { LookbookSelectionBus } from '../booking/lookbook-selection';

/**
 * Guest landing page (route `/`).
 *
 * Composes the public marketing sections and hosts the booking wizard. Owns
 * only shell-level UI state (login modal + lookbook → wizard hand-off); the
 * booking flow itself lives in `BookingStore`, which this component deliberately does NOT
 * import — see {@link LookbookSelectionBus}.
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
  private readonly lookbookSelection = inject(LookbookSelectionBus);
  private readonly appointmentStore = inject(AppointmentStore);
  private readonly catalogStore = inject(ServiceCatalogStore);
  private readonly router = inject(Router);
  private readonly dashboardPrefetch = inject(DashboardPrefetch);

  readonly isLoggedIn = this.authState.isLoggedIn;
  readonly showAdminLoginModal = signal(false);
  readonly services = this.catalogStore.services;
  readonly servicesLoading = this.catalogStore.isLoading;
  readonly servicesError = this.catalogStore.errorMessage;
  readonly servicesLoaded = this.catalogStore.hasLoaded;
  /** Placeholder rows shown until the catalog arrives; the seeded catalog has five services. */
  readonly skeletonRows = [0, 1, 2, 3, 4];

  constructor() {
    // A session that expired elsewhere in the app sends the user here with the
    // login modal requested (AuthState owns the "session expired" notice).
    effect(() => {
      if (this.authState.loginPromptRequested()) {
        this.showAdminLoginModal.set(true);
        this.authState.loginPromptRequested.set(false);
      }
    });

    // Opening the login modal is the signal that a dashboard comes next: fetch its chunk while
    // the user types, not after the login response.
    effect(() => {
      if (this.showAdminLoginModal()) this.dashboardPrefetch.prefetch();
    });

    // A signed-in user landing on `/` goes straight to their dashboard.
    effect(() => {
      const role = this.authState.role();
      if (role) {
        this.router.navigateByUrl(this.authState.dashboardPathFor(role));
      }
    });
  }

  retryServices(): void {
    this.catalogStore.loadServices();
  }

  selectLookbookStyle(serviceName: string, category: string): void {
    this.lookbookSelection.select(serviceName, category);
  }

  onAuthLoginSuccess(role: string): void {
    this.appointmentStore.showSuccess(
      role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!',
    );
    this.router.navigateByUrl(this.authState.dashboardPathFor(role));
  }
}
