import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthState } from '../../core/auth/auth.state';
import { DashboardPrefetch } from '../../dashboard-loaders';
import { AppointmentStore } from '../../core/appointments/appointment.store';
import { ServiceCatalogStore } from '../../core/catalog/service-catalog.store';
import { AnnouncementBarComponent } from './announcement-bar/announcement-bar';
import { AuthModalComponent } from './auth-modal/auth-modal';
import { FaqSectionComponent } from './faq-section/faq-section';
import { LookbookComponent } from './lookbook/lookbook';
import { PostBookingActionsComponent } from './post-booking-actions/post-booking-actions';
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

  protected readonly isLoggedIn = this.authState.isLoggedIn;
  readonly showAdminLoginModal = signal(false);
  protected readonly services = this.catalogStore.services;
  readonly servicesLoading = this.catalogStore.isLoading;
  protected readonly servicesError = this.catalogStore.errorMessage;
  protected readonly servicesLoaded = this.catalogStore.hasLoaded;
  /** Placeholder rows shown until the catalog arrives; the seeded catalog has five services. */
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

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

  protected selectLookbookStyle(serviceName: string, category: string): void {
    this.lookbookSelection.select(serviceName, category);
  }

  protected onAuthLoginSuccess(role: string): void {
    this.appointmentStore.showSuccess(
      role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!',
    );
    this.router.navigateByUrl(this.authState.dashboardPathFor(role));
  }
}
