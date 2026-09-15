import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, afterEach, beforeEach, expect, it } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { PUBLIC_REQUEST } from './core/http/public-request.token';
import { SessionEvents } from './core/session-events';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let sessionEvents: SessionEvents;
  let unauthorizedCalls: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    sessionEvents = TestBed.inject(SessionEvents);
    unauthorizedCalls = 0;
    sessionEvents.unauthorized.subscribe(() => unauthorizedCalls++);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('does not clear a session when a public booking attempt receives a 401', () => {
    http
      .post('/api/v1/appointments', {}, { context: new HttpContext().set(PUBLIC_REQUEST, true) })
      .subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/appointments').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(unauthorizedCalls).toBe(0);
  });

  it('does not clear a session when a public review submission receives a 401', () => {
    http
      .post(
        '/api/v1/reviews/public/TF-0001',
        {},
        {
          context: new HttpContext().set(PUBLIC_REQUEST, true),
        },
      )
      .subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/reviews/public/TF-0001').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(unauthorizedCalls).toBe(0);
  });

  it('clears a session when the protected identity endpoint receives a 401', () => {
    http.get('/api/v1/auth/me').subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/auth/me').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(unauthorizedCalls).toBe(1);
  });

  it('ignores non-401 failures', () => {
    http.get('/api/v1/auth/me').subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/auth/me').flush(null, {
      status: 500,
      statusText: 'Server Error',
    });

    expect(unauthorizedCalls).toBe(0);
  });
});
