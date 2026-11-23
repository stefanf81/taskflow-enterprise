import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthState } from '../../core/auth/auth.state';
import { DashboardPrefetch } from '../../dashboard-loaders';
import { FlashMessages } from '../../core/ui/flash-messages';
import { ShopClock } from '../../core/shop-clock';
import { isOpenAt } from '@taskflow/domain';
import { AnnouncementBarComponent } from './announcement-bar/announcement-bar';
import { AuthModalComponent } from './auth-modal/auth-modal';
import { FaqSectionComponent } from './faq-section/faq-section';
import { LookbookComponent } from './lookbook/lookbook';
import { PostBookingActionsComponent } from './post-booking-actions/post-booking-actions';
import { BookingWizard } from '../booking/booking-wizard';
import { LookbookSelectionBus } from '../booking/lookbook-selection';
import { ShopDetails } from './shop-details/shop-details';
import { circleCheckIcon } from '../../core/ui/icons/circle-check';
import { hourglassIcon } from '../../core/ui/icons/hourglass';
import { lockIcon } from '../../core/ui/icons/lock';
import { Icon } from '../../core/ui/icon';

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
    ShopDetails,
    Icon,
  ],
  templateUrl: './landing-page.html',
})
export class LandingPage {
  protected readonly icons = {
    circleCheck: circleCheckIcon,
    hourglass: hourglassIcon,
    lock: lockIcon,
  };
  private readonly authState = inject(AuthState);
  private readonly lookbookSelection = inject(LookbookSelectionBus);
  private readonly flash = inject(FlashMessages);
  private readonly router = inject(Router);
  private readonly dashboardPrefetch = inject(DashboardPrefetch);
  private readonly shopClock = inject(ShopClock);

  /** Open right now in the shop's time zone; null until the real hours are known (and prerendering). */
  protected readonly openNow = computed(() =>
    this.shopClock.loaded() ? isOpenAt(this.shopClock.now(), this.shopClock.rules()) : null,
  );

  protected readonly isLoggedIn = this.authState.isLoggedIn;
  readonly showAdminLoginModal = signal(false);

  constructor() {
    this.shopClock.watch(inject(DestroyRef));

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
        void this.router.navigateByUrl(this.authState.dashboardPathFor(role));
      }
    });
  }

  protected selectLookbookStyle(serviceName: string, category: string): void {
    this.lookbookSelection.select(serviceName, category);
  }

  protected onAuthLoginSuccess(role: string): void {
    // The sign-in itself already wiped the banner (FlashMessages clears on sessionStarted), so a
    // guest's failed cancel or review cannot follow the user into the dashboard as a role="alert".
    this.flash.showSuccess(role === 'ROLE_ADMIN' ? 'Welcome back, Owner!' : 'Welcome back!');
    void this.router.navigateByUrl(this.authState.dashboardPathFor(role));
  }
}
