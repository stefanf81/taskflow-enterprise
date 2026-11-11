import { TestBed, ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthState } from './core/auth/auth.state';

describe('App shell', () => {
  let fixture: ComponentFixture<App>;
  let app: App;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    document.cookie = 'taskflow_session=; max-age=0; path=/';
  });

  /** The readable hint the server sets next to the session cookies. */
  function withSessionHint(): void {
    document.cookie = 'taskflow_session=1; path=/';
  }

  function flushMe(status: 'ok' | 'unauthorized', role?: string): void {
    const reqs = httpMock.match((req) => req.url.includes('/api/v1/auth/me'));
    expect(reqs.length).toBeGreaterThan(0);
    for (const req of reqs) {
      if (status === 'ok') {
        req.flush({ role, username: 'user' });
      } else {
        req.flush(null, { status: 401, statusText: 'Unauthorized' });
      }
    }
  }

  it('compiles and renders the routed shell', () => {
    expect(app).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).toBeTruthy();
  });

  it('restores an existing session WITHOUT navigating away from the current URL', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const authState = TestBed.inject(AuthState);
    withSessionHint();

    fixture.detectChanges();
    flushMe('ok', 'ROLE_CUSTOMER');

    await fixture.whenStable();
    expect(authState.role()).toBe('ROLE_CUSTOMER');
    // Redirecting from here used to bounce a deep link such as /customer/book to /customer.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stays logged out without asking the server when no session hint is present', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const authState = TestBed.inject(AuthState);

    fixture.detectChanges();
    httpMock.expectNone((req) => req.url.includes('/api/v1/auth/me'));

    await fixture.whenStable();
    expect(authState.isLoggedIn()).toBe(false);
    expect(authState.isBootstrapDone()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stays logged out when the session behind the hint is gone', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const authState = TestBed.inject(AuthState);
    withSessionHint();

    fixture.detectChanges();
    flushMe('unauthorized');
    for (const renew of httpMock.match((req) => req.url.includes('/api/v1/auth/refresh'))) {
      renew.flush(null, { status: 401, statusText: 'Unauthorized' });
    }

    await fixture.whenStable();
    expect(authState.isLoggedIn()).toBe(false);
    // The guest's 401 completes the bootstrap instead of being left "pending" forever.
    expect(authState.isBootstrapDone()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});
