import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { LandingPage } from './landing-page';
import { AuthState, SESSION_EXPIRED_MESSAGE } from '../../auth.state';
import { ServiceCatalogStore } from '../../service-catalog.store';
import { DashboardPrefetch } from '../../dashboard-loaders';
// Imported for its side effect only: the wizard is behind `@defer`, whose dynamic import would
// otherwise have to be transformed mid-test, taking longer than the settle loop below waits.
import '../booking/booking-wizard';

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
      .forEach((r) => r.flush({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
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

  it('renders the public navigation, hero and booking wizard', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.textContent).toContain('TaskFlow');
    expect(compiled.querySelector('header')?.textContent).toContain('Luxury Barber');
    expect(compiled.querySelector('app-booking-wizard')).toBeTruthy();
  });

  it('opens the owner portal login modal only when triggered', () => {
    const page = fixture.componentInstance;
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(page.showAdminLoginModal()).toBe(false);

    button.click();

    expect(page.showAdminLoginModal()).toBe(true);
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
