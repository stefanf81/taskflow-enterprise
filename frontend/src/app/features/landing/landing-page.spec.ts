import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { LandingPage } from './landing-page';
import { AuthState, SESSION_EXPIRED_MESSAGE } from '../../core/auth/auth.state';
import { ServiceCatalogStore } from '../../core/catalog/service-catalog.store';
import { DashboardPrefetch } from '../../dashboard-loaders';
import { FlashMessages } from '../../core/ui/flash-messages';
import { ReviewStore } from '../../core/reviews/review.store';
// Imported for its side effect only: the wizard is behind `@defer`, whose dynamic import would
// otherwise have to be transformed mid-test, taking longer than the settle loop below waits.
import '../booking/booking-wizard';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';

/** The body of the "Client Ratings" card (the box that holds its height while loading). */
function ratingsBody(root: HTMLElement): HTMLElement | undefined {
  const heading = Array.from(root.querySelectorAll<HTMLElement>('h3')).find((h) =>
    h.textContent?.includes('Client Ratings'),
  );
  return (heading?.nextElementSibling as HTMLElement | null) ?? undefined;
}

/** The open/closed badge in the guest navigation. */
function openClosedBadge(root: HTMLElement): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('nav span')).find((span) =>
    span.textContent?.includes('●'),
  );
}

describe('LandingPage before the shop hours are known', () => {
  it('keeps the open/closed badge in the layout, invisible', () => {
    // /public/shop is never answered: the state of the prerendered page and of a slow first load.
    // The badge must already take its space, or the nav wraps when it appears and on a phone the
    // whole page moves down (BENCHMARKS.md §72).
    TestBed.configureTestingModule({
      imports: [LandingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DashboardPrefetch, useValue: { prefetch: vi.fn() } },
      ],
    });
    const pending = TestBed.createComponent(LandingPage);
    pending.detectChanges();

    const badge = openClosedBadge(pending.nativeElement);
    expect(badge).toBeTruthy();
    expect(badge?.classList).toContain('invisible');

    // The ratings are not answered either: the card keeps its box, empty rather than claiming
    // "No reviews yet" (which the prerendered page would otherwise show to everyone).
    const ratings = ratingsBody(pending.nativeElement);
    expect(ratings?.classList).toContain('min-h-12');
    expect(ratings?.textContent?.trim()).toBe('');
  });
});

describe('LandingPage', () => {
  let fixture: ComponentFixture<LandingPage>;
  let httpMock: HttpTestingController;
  let dashboardPrefetch: { prefetch: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dashboardPrefetch = { prefetch: vi.fn() };
    TestBed.configureTestingModule({
      imports: [LandingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DashboardPrefetch, useValue: dashboardPrefetch },
      ],
    });
    fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();

    httpMock = TestBed.inject(HttpTestingController);
    // The booking wizard sits in a `@defer (on idle)` block, so it mounts — and issues its own
    // requests — only after that trigger fires, which is one or more macrotasks after the first
    // round of flushes. Drain repeatedly instead of flushing once, or `whenStable()` waits
    // forever on requests that had not been made yet.
    await settlePublicRequests();
    expect(fixture.nativeElement.querySelector('app-booking-wizard')).toBeTruthy();
  });

  /** Flushes every public GET the landing page and its deferred children make. */
  function flushPublicRequests(): void {
    httpMock.match((req) => req.url.includes('/api/v1/catalog')).forEach((req) => req.flush([]));
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush([]));
    httpMock.match((req) => req.url === '/api/v1/barbers').forEach((req) => req.flush([]));
    // The shop's zone is the machine's own, so the wizard's clock is unchanged in these specs.
    httpMock
      .match((r) => r.url.includes('/public/shop'))
      .forEach((r) =>
        r.flush({
          ...DEFAULT_SHOP_RULES,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      );
  }

  /**
   * Renders, flushes and lets timers run until the wizard's defer block has mounted and its
   * requests are answered. `whenStable()` is deliberately not used: the wizard's requests only
   * exist after the block resolves, so awaiting stability before they are flushed deadlocks.
   */
  async function settlePublicRequests(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      fixture.detectChanges();
      flushPublicRequests();
      if (fixture.nativeElement.querySelector('app-booking-wizard')) break;
      await new Promise((resolve) => setTimeout(resolve));
    }
    // One more round for anything the now-mounted wizard asked for.
    fixture.detectChanges();
    flushPublicRequests();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('shows the opening hours and open/closed badge from the shop info', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // DEFAULT_SHOP_RULES were flushed for /public/shop: Monday-Saturday 09:00-17:00.
    expect(text).toContain('Monday - Saturday');
    expect(text).toContain('9:00 AM - 5:00 PM');
    expect(text).toMatch(/Sunday\s*CLOSED/);
    expect(text).toMatch(/● (Shop Open|Closed Now)/);
    expect(openClosedBadge(fixture.nativeElement)?.classList).not.toContain('invisible');
  });

  it('renders the public navigation, hero and booking wizard', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.textContent).toContain('TaskFlow');
    expect(compiled.querySelector('header')?.textContent).toContain('Luxury Barber');
    expect(compiled.querySelector('app-booking-wizard')).toBeTruthy();
  });

  it('drops a guest form error when the visitor signs in', () => {
    const flash = TestBed.inject(FlashMessages);
    flash.errorMessage.set('Verification failed. Please check your Booking Code and Email.');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    // What the login modal does: record the session, then hand over to the page.
    TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
    fixture.componentInstance['onAuthLoginSuccess']('ROLE_ADMIN');

    expect(navigate).toHaveBeenCalledWith('/admin');

    expect(flash.errorMessage()).toBeNull();
    expect(flash.successMessage()).toBe('Welcome back, Owner!');
  });

  it('opens the login modal only when the nav\'s "Sign in" is clicked', () => {
    const page = fixture.componentInstance;
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('nav button'),
    ).find((b) => b.textContent?.trim() === 'Sign in');
    expect(button).toBeTruthy();
    expect(page.showAdminLoginModal()).toBe(false);

    button?.click();

    expect(page.showAdminLoginModal()).toBe(true);
  });

  it('says so when nobody has been reviewed yet', () => {
    // beforeEach answered /reviews/public/barber-ratings with an empty list.
    expect(ratingsBody(fixture.nativeElement)?.textContent).toContain('No reviews yet');
  });

  it('shows the real shop rating instead of a hand-picked quote', async () => {
    TestBed.inject(ReviewStore).loadRatings();
    fixture.detectChanges();
    httpMock
      .expectOne((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .flush([
        { barberName: 'Alex the Barber', averageRating: 4.5, reviewCount: 10 },
        { barberName: 'Sara the Stylist', averageRating: 5, reviewCount: 30 },
      ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = ratingsBody(fixture.nativeElement)?.textContent?.replace(/\s+/g, ' ') ?? '';
    // (4.5 × 10 + 5 × 30) / 40 = 4.875
    expect(text).toContain('4.9 out of 5');
    expect(text).toContain('from 40 reviews');
    expect(text).toContain('Top rated: Sara the Stylist · 5.0');
    expect(fixture.nativeElement.textContent).not.toContain('Liam K.');
  });

  it('prefetches the dashboard chunks when the login modal opens, not before', () => {
    expect(dashboardPrefetch.prefetch).not.toHaveBeenCalled();

    fixture.componentInstance.showAdminLoginModal.set(true);
    fixture.detectChanges();

    expect(dashboardPrefetch.prefetch).toHaveBeenCalled();
  });

  describe('session expiry hand-off (FE-4)', () => {
    it('opens the login modal with the expiry notice when AuthState asks for it', async () => {
      const auth = TestBed.inject(AuthState);
      auth.sessionNotice.set(SESSION_EXPIRED_MESSAGE);
      auth.loginPromptRequested.set(true);

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.showAdminLoginModal()).toBe(true);
      // One-shot: the request is consumed so revisiting the page does not reopen the modal.
      expect(auth.loginPromptRequested()).toBe(false);
      const modal = (fixture.nativeElement as HTMLElement).querySelector('app-auth-modal');
      expect(modal?.textContent).toContain(SESSION_EXPIRED_MESSAGE);
    });
  });

  describe('signed-in visitors', () => {
    it('sends a signed-in customer to the portal (its booking entry lives there)', () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      TestBed.inject(AuthState).applyRole('ROLE_CUSTOMER', 'jane@example.com');
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith('/customer');
    });

    it('sends a signed-in admin to the owner dashboard', () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      TestBed.inject(AuthState).applyRole('ROLE_ADMIN', 'admin');
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith('/admin');
    });
  });

  describe('failed menu load (FE-1)', () => {
    it('keeps the page alive and offers a retry', async () => {
      TestBed.inject(ServiceCatalogStore).loadServices();
      fixture.detectChanges();
      httpMock
        .match((req) => req.url.includes('/api/v1/catalog'))
        .forEach((req) => req.flush(null, { status: 500, statusText: 'Server Error' }));
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Could not load service catalog.');
      expect(el.textContent).toContain('Grooming Menu');
      expect(el.querySelector('app-booking-wizard')).toBeTruthy();

      fixture.componentInstance.retryServices();
      fixture.detectChanges();
      httpMock.match((req) => req.url.includes('/api/v1/catalog')).forEach((req) => req.flush([]));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Could not load service catalog.');
    });
  });
});
