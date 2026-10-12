import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthState, SESSION_EXPIRED_MESSAGE } from './auth.state';
import { authInterceptor } from './auth.interceptor';
import { LoginResponse } from './types/api';
import { AuthApi } from './core/api/auth-api';
import { SessionEvents } from './core/session-events';

describe('AuthState (mocked AuthApi)', () => {
  let authState: AuthState;
  let me$: Subject<LoginResponse>;

  beforeEach(() => {
    me$ = new Subject<LoginResponse>();
    TestBed.configureTestingModule({
      providers: [
        AuthState,
        provideRouter([]),
        { provide: AuthApi, useValue: { me: vi.fn(() => me$.asObservable()) } },
      ],
    });
    authState = TestBed.inject(AuthState);
  });

  it('does not restore authentication when a pre-logout bootstrap completes late', () => {
    authState.bootstrap().subscribe();
    authState.clear();

    me$.next({ username: 'admin', role: 'ROLE_ADMIN' });

    expect(authState.isLoggedIn()).toBe(false);
    expect(authState.role()).toBe('');
  });

  it('does not let a slow /me answer (success or failure) override a newer login', () => {
    authState.bootstrap().subscribe({ error: () => undefined });
    authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

    me$.error({ status: 401 });

    expect(authState.isLoggedIn()).toBe(true);
    expect(authState.role()).toBe('ROLE_CUSTOMER');
    expect(authState.username()).toBe('jane@example.com');
    expect(authState.isBootstrapDone()).toBe(true);
  });

  it('ignores a late /me success that belongs to a superseded bootstrap', () => {
    authState.bootstrap().subscribe();
    authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

    me$.next({ username: 'admin', role: 'ROLE_ADMIN' });

    expect(authState.role()).toBe('ROLE_CUSTOMER');
  });
});

describe('AuthState (HTTP + interceptor)', () => {
  let authState: AuthState;
  let httpTesting: HttpTestingController;
  let sessionEvents: SessionEvents;
  let navigate: ReturnType<typeof vi.spyOn>;
  let unauthorizedCalls: number;
  let sessionEndedCalls: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    authState = TestBed.inject(AuthState);
    httpTesting = TestBed.inject(HttpTestingController);
    sessionEvents = TestBed.inject(SessionEvents);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    unauthorizedCalls = 0;
    sessionEndedCalls = 0;
    sessionEvents.unauthorized.subscribe(() => unauthorizedCalls++);
    sessionEvents.sessionEnded.subscribe(() => sessionEndedCalls++);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  describe('guest bootstrap (FE-9)', () => {
    it('completes as "no session" on a /me 401 without broadcasting an expiry', () => {
      const results: string[] = [];
      authState.bootstrap().subscribe({
        next: (role) => results.push(role),
        error: () => results.push('error'),
      });

      httpTesting
        .expectOne('/api/v1/auth/me')
        .flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(results).toEqual(['error']);
      expect(authState.isBootstrapDone()).toBe(true);
      expect(authState.isLoggedIn()).toBe(false);
      // The 401 was the expected "no session" answer, not an expiry.
      expect(unauthorizedCalls).toBe(0);
      expect(navigate).not.toHaveBeenCalled();
      expect(authState.sessionNotice()).toBeNull();
    });

    it('does not ask the server again once the guest bootstrap finished', () => {
      authState.bootstrap().subscribe({ error: () => undefined });
      httpTesting.expectOne('/api/v1/auth/me').flush(null, { status: 401, statusText: 'x' });

      expect(authState.isBootstrapDone()).toBe(true);
      httpTesting.expectNone('/api/v1/auth/me');
    });

    it('restores the principal (role and username) on success', () => {
      authState.bootstrap().subscribe();
      httpTesting
        .expectOne('/api/v1/auth/me')
        .flush({ username: 'jane@example.com', role: 'ROLE_CUSTOMER' });

      expect(authState.role()).toBe('ROLE_CUSTOMER');
      expect(authState.username()).toBe('jane@example.com');
      expect(authState.isBootstrapDone()).toBe(true);
    });

    it('a late /me 401 arriving after a login does not wipe the new session', () => {
      authState.bootstrap().subscribe({ error: () => undefined });
      authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

      httpTesting
        .expectOne('/api/v1/auth/me')
        .flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(authState.isLoggedIn()).toBe(true);
      expect(authState.role()).toBe('ROLE_CUSTOMER');
      expect(sessionEndedCalls).toBe(0);
    });
  });

  describe('session expiry (FE-4)', () => {
    it('clears the session, leaves a notice, asks for the login modal and goes home', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      sessionEvents.notifyUnauthorized();

      expect(authState.isLoggedIn()).toBe(false);
      expect(authState.sessionNotice()).toBe(SESSION_EXPIRED_MESSAGE);
      expect(authState.loginPromptRequested()).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/');
      expect(sessionEndedCalls).toBe(1);
    });

    it('is triggered by a real protected 401 through the interceptor', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: () => undefined });
      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });

      expect(authState.isLoggedIn()).toBe(false);
      expect(authState.sessionNotice()).toBe(SESSION_EXPIRED_MESSAGE);
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('a 401 from logout itself never looks like an expiry', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      TestBed.inject(AuthApi)
        .logout()
        .subscribe({ error: () => undefined });
      httpTesting.expectOne('/api/v1/auth/logout').flush(null, { status: 401, statusText: 'x' });

      expect(unauthorizedCalls).toBe(0);
      expect(authState.sessionNotice()).toBeNull();
    });

    it('ignores a stray 401 when nobody is signed in', () => {
      sessionEvents.notifyUnauthorized();

      expect(authState.sessionNotice()).toBeNull();
      expect(authState.loginPromptRequested()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(sessionEndedCalls).toBe(0);
    });

    it('clears the notice on the next successful login', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      sessionEvents.notifyUnauthorized();
      expect(authState.sessionNotice()).not.toBeNull();

      authState.applyRole('ROLE_ADMIN', 'admin');

      expect(authState.sessionNotice()).toBeNull();
    });
  });

  describe('logout (FE-3)', () => {
    it('keeps the user signed in until the server confirms, then clears', async () => {
      authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

      const done = authState.logoutAndWait();
      expect(authState.isLoggedIn()).toBe(true);

      const req = httpTesting.expectOne('/api/v1/auth/logout');
      expect(req.request.method).toBe('POST');
      req.flush(null);
      await done;

      expect(authState.isLoggedIn()).toBe(false);
      expect(authState.username()).toBe('');
      expect(sessionEndedCalls).toBe(1);
    });

    it('refetches the CSRF token and retries ONCE after a 403', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      const done = authState.logoutAndWait();
      httpTesting
        .expectOne('/api/v1/auth/logout')
        .flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
      expect(authState.isLoggedIn()).toBe(true);

      httpTesting.expectOne('/api/v1/auth/csrf').flush(null);
      httpTesting.expectOne('/api/v1/auth/logout').flush(null);
      await done;

      expect(authState.isLoggedIn()).toBe(false);
    });

    it('stays signed in (and does not bounce to login) when the retry also fails', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      const done = authState.logoutAndWait();
      httpTesting.expectOne('/api/v1/auth/logout').flush(null, { status: 403, statusText: 'x' });
      httpTesting.expectOne('/api/v1/auth/csrf').flush(null);
      httpTesting.expectOne('/api/v1/auth/logout').flush(null, { status: 403, statusText: 'x' });

      await expect(done).rejects.toMatchObject({ status: 403 });
      expect(authState.isLoggedIn()).toBe(true);
      expect(authState.role()).toBe('ROLE_ADMIN');
      expect(authState.sessionNotice()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(sessionEndedCalls).toBe(0);
    });

    it('stays signed in when the CSRF refetch itself fails', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      const done = authState.logoutAndWait();
      httpTesting.expectOne('/api/v1/auth/logout').flush(null, { status: 403, statusText: 'x' });
      httpTesting.expectOne('/api/v1/auth/csrf').error(new ProgressEvent('error'));

      await expect(done).rejects.toBeTruthy();
      expect(authState.isLoggedIn()).toBe(true);
    });

    it('stays signed in on a server error (the cookie is still valid)', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      const done = authState.logoutAndWait();
      httpTesting.expectOne('/api/v1/auth/logout').flush(null, { status: 500, statusText: 'x' });

      await expect(done).rejects.toMatchObject({ status: 500 });
      expect(authState.isLoggedIn()).toBe(true);
    });

    it('treats a 401 as "already signed out" and clears locally', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');

      const done = authState.logoutAndWait();
      httpTesting.expectOne('/api/v1/auth/logout').flush(null, { status: 401, statusText: 'x' });
      await done;

      expect(authState.isLoggedIn()).toBe(false);
    });
  });

  it('only announces sessionEnded when an authenticated session actually ended', () => {
    authState.clear();
    expect(sessionEndedCalls).toBe(0);

    authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');
    authState.clear();
    expect(sessionEndedCalls).toBe(1);
  });
});
