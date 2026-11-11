import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthState, SESSION_EXPIRED_MESSAGE } from './auth.state';
import { authInterceptor } from './auth.interceptor';
import { LoginResponse } from '../../types/api';
import { AuthApi } from '../api/auth-api';
import { SessionEvents } from '../session-events';

/** The readable session hint the server sets with every access cookie (see session-hint.ts). */
const setHint = () => (document.cookie = 'taskflow_session=1; path=/');
const dropHint = () => (document.cookie = 'taskflow_session=; max-age=0; path=/');

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
    setHint();
  });

  afterEach(() => dropHint());

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

  describe('guest without a session hint', () => {
    it('completes as "no session" without asking the server', () => {
      const results: string[] = [];
      authState.bootstrap().subscribe({
        next: (role) => results.push(role),
        error: () => results.push('error'),
      });

      // No /me request: it could only answer 401, and it spends the per-IP auth budget.
      httpTesting.expectNone('/api/v1/auth/me');
      expect(results).toEqual(['error']);
      expect(authState.isBootstrapDone()).toBe(true);
      expect(authState.isLoggedIn()).toBe(false);
      expect(unauthorizedCalls).toBe(0);
      expect(sessionEndedCalls).toBe(0);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('keeps a session signed in during this page load', () => {
      authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

      authState.bootstrap().subscribe({ error: () => undefined });

      httpTesting.expectOne('/api/v1/auth/me').flush({
        username: 'jane@example.com',
        role: 'ROLE_CUSTOMER',
      });
      expect(authState.isLoggedIn()).toBe(true);
      expect(sessionEndedCalls).toBe(0);
    });
  });

  describe('guest bootstrap with a session hint (FE-9)', () => {
    beforeEach(() => setHint());
    afterEach(() => dropHint());

    it('completes as "no session" when /me and the renewal both answer 401, without broadcasting an expiry', () => {
      const results: string[] = [];
      authState.bootstrap().subscribe({
        next: (role) => results.push(role),
        error: () => results.push('error'),
      });

      httpTesting
        .expectOne('/api/v1/auth/me')
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      // The hint said the browser could renew; the server says the session is gone.
      httpTesting
        .expectOne('/api/v1/auth/refresh')
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
      httpTesting.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'x' });

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
      for (const renew of httpTesting.match('/api/v1/auth/refresh')) {
        renew.flush(null, { status: 401, statusText: 'Unauthorized' });
      }

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

    it('ignores a 401 for a request sent before the current sign-in', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: () => undefined });
      authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });

      expect(unauthorizedCalls).toBe(0);
      expect(authState.isLoggedIn()).toBe(true);
      expect(authState.username()).toBe('jane@example.com');
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

  describe('session renewal with the refresh cookie (ADR-023)', () => {
    let sessionStartedCalls: number;

    beforeEach(() => {
      sessionStartedCalls = 0;
      sessionEvents.sessionStarted.subscribe(() => sessionStartedCalls++);
    });

    afterEach(() => dropHint());

    it('restores a browser whose access cookie expired instead of showing the guest page', () => {
      setHint();
      const results: string[] = [];
      authState.bootstrap().subscribe({ next: (role) => results.push(role) });

      httpTesting
        .expectOne('/api/v1/auth/me')
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      const renew = httpTesting.expectOne('/api/v1/auth/refresh');
      expect(renew.request.method).toBe('POST');
      renew.flush({ username: 'jane@example.com', role: 'ROLE_CUSTOMER' });

      expect(results).toEqual(['ROLE_CUSTOMER']);
      expect(authState.isLoggedIn()).toBe(true);
      expect(authState.username()).toBe('jane@example.com');
      // The session continued; nobody signed in.
      expect(sessionStartedCalls).toBe(0);
    });

    it('stays a guest when the renewal at boot is refused', () => {
      setHint();
      authState.bootstrap().subscribe({ error: () => undefined });

      httpTesting.expectOne('/api/v1/auth/me').flush(null, { status: 401, statusText: 'x' });
      httpTesting.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'x' });

      expect(authState.isLoggedIn()).toBe(false);
      expect(authState.isBootstrapDone()).toBe(true);
      expect(unauthorizedCalls).toBe(0);
    });

    it('renews once and replays a protected request that hit an expired access cookie', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      const bodies: unknown[] = [];
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ next: (body) => bodies.push(body) });

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      httpTesting
        .expectOne('/api/v1/auth/refresh')
        .flush({ username: 'admin', role: 'ROLE_ADMIN' });
      httpTesting.expectOne('/api/v1/appointments').flush({ content: [] });

      expect(bodies).toEqual([{ content: [] }]);
      expect(unauthorizedCalls).toBe(0);
      expect(authState.isLoggedIn()).toBe(true);
    });

    it('shares one renewal between concurrent 401s', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      const http = TestBed.inject(HttpClient);
      http.get('/api/v1/appointments').subscribe();
      http.get('/api/v1/notifications').subscribe();

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      httpTesting.expectOne('/api/v1/notifications').flush(null, { status: 401, statusText: 'x' });
      httpTesting
        .expectOne('/api/v1/auth/refresh')
        .flush({ username: 'admin', role: 'ROLE_ADMIN' });
      httpTesting.expectOne('/api/v1/appointments').flush([]);
      httpTesting.expectOne('/api/v1/notifications').flush([]);

      expect(unauthorizedCalls).toBe(0);
    });

    it('refetches the CSRF token once when the renewal is refused with 403', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      TestBed.inject(HttpClient).get('/api/v1/appointments').subscribe();

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      httpTesting.expectOne('/api/v1/auth/refresh').flush(null, { status: 403, statusText: 'x' });
      httpTesting.expectOne('/api/v1/auth/csrf').flush({ token: 't' });
      httpTesting
        .expectOne('/api/v1/auth/refresh')
        .flush({ username: 'admin', role: 'ROLE_ADMIN' });
      httpTesting.expectOne('/api/v1/appointments').flush([]);

      expect(unauthorizedCalls).toBe(0);
    });

    it('ends the session when the renewal is rejected', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: () => undefined });

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      httpTesting.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'x' });

      expect(unauthorizedCalls).toBe(1);
      expect(authState.sessionNotice()).toBe(SESSION_EXPIRED_MESSAGE);
    });

    it.each([
      [
        'a server error',
        (req: TestRequest) => req.flush(null, { status: 503, statusText: 'x' }),
        503,
      ],
      ['a network failure', (req: TestRequest) => req.error(new ProgressEvent('error')), 0],
    ])('keeps the session when the renewal fails with %s', (_cause, fail, status) => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      const errors: unknown[] = [];
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: (err) => errors.push(err) });

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      fail(httpTesting.expectOne('/api/v1/auth/refresh'));

      expect(unauthorizedCalls).toBe(0);
      expect(authState.isLoggedIn()).toBe(true);
      expect(authState.sessionNotice()).toBeNull();
      // The caller learns why (offline, server down) instead of a misleading 401.
      expect(errors).toEqual([expect.objectContaining({ status })]);
    });

    it('neither applies nor replays a renewal that a logout overtook', async () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      const results: string[] = [];
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({
          next: () => results.push('replayed'),
          error: (err) => results.push(`error ${err.status}`),
        });
      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      const renew = httpTesting.expectOne('/api/v1/auth/refresh');

      const done = authState.logoutAndWait();
      httpTesting.expectOne('/api/v1/auth/logout').flush(null);
      await done;
      renew.flush({ username: 'admin', role: 'ROLE_ADMIN' });

      httpTesting.expectNone('/api/v1/appointments');
      expect(results).toEqual(['error 401']);
      expect(authState.isLoggedIn()).toBe(false);
      expect(unauthorizedCalls).toBe(0);
    });

    it('does not let an outdated renewal rejection end a newer login', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: () => undefined });
      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      const renew = httpTesting.expectOne('/api/v1/auth/refresh');

      authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');
      renew.flush(null, { status: 401, statusText: 'x' });

      expect(unauthorizedCalls).toBe(0);
      expect(authState.isLoggedIn()).toBe(true);
      expect(authState.username()).toBe('jane@example.com');
    });

    it('does not let an outdated renewal success replace a newer login or replay', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: () => undefined });
      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      const renew = httpTesting.expectOne('/api/v1/auth/refresh');

      authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');
      renew.flush({ username: 'admin', role: 'ROLE_ADMIN' });

      httpTesting.expectNone('/api/v1/appointments');
      expect(authState.role()).toBe('ROLE_CUSTOMER');
      expect(authState.username()).toBe('jane@example.com');
    });

    it('ends the session when the replay after a renewal is rejected again', () => {
      authState.applyRole('ROLE_ADMIN', 'admin');
      setHint();
      TestBed.inject(HttpClient)
        .get('/api/v1/appointments')
        .subscribe({ error: () => undefined });

      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });
      httpTesting
        .expectOne('/api/v1/auth/refresh')
        .flush({ username: 'admin', role: 'ROLE_ADMIN' });
      httpTesting.expectOne('/api/v1/appointments').flush(null, { status: 401, statusText: 'x' });

      expect(unauthorizedCalls).toBe(1);
      httpTesting.expectNone('/api/v1/auth/refresh');
    });
  });
});
