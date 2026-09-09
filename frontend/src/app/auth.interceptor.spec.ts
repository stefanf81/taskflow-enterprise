import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  const unauthorized = vi.fn();
  let unauthorizedHandler: EventListener;

  beforeEach(() => {
    unauthorized.mockClear();
    unauthorizedHandler = () => unauthorized();
    window.addEventListener('auth:unauthorized', unauthorizedHandler);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    window.removeEventListener('auth:unauthorized', unauthorizedHandler);
    httpTesting.verify();
  });

  it('does not clear a session when public booking receives a 401', () => {
    http.post('/api/v1/appointments', {}).subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/appointments').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('does not clear a session when public review submission receives a 401', () => {
    http.post('/api/v1/reviews/public/TF-0001', {}).subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/reviews/public/TF-0001').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('clears a session when the protected identity endpoint receives a 401', () => {
    http.get('/api/v1/auth/me').subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/auth/me').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
