import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, afterEach, beforeEach, expect, it } from 'vitest';
import { appointmentCreateSchema, registerSchema } from '@taskflow/schemas';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { AppointmentsApi } from './appointments-api';
import { AuthApi } from './auth-api';
import { NETWORK_ERROR_MESSAGE, extractApiError } from './extract-api-error';
import { RequestValidationError, parseRequest } from './request-validation';
import { ReviewsApi } from './reviews-api';

describe('core/api clients', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  describe('path parameters are URL-encoded (FE-12)', () => {
    const hostile = 'TF/../admin?x=1#frag';
    const encoded = encodeURIComponent(hostile);

    it('encodes the booking code of a public cancellation', () => {
      TestBed.inject(AppointmentsApi)
        .publicCancelAppointment(hostile, 'jane@example.com')
        .subscribe();

      const req = httpTesting.expectOne(`/api/v1/appointments/public/cancel/${encoded}`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ email: 'jane@example.com' });
      req.flush(null);
    });

    it('encodes the booking code of a public review', () => {
      TestBed.inject(ReviewsApi)
        .submitReview(hostile, { rating: 5, comment: 'great', customerEmail: 'jane@example.com' })
        .subscribe();

      const req = httpTesting.expectOne(`/api/v1/reviews/public/${encoded}`);
      expect(req.request.method).toBe('POST');
      req.flush(null);
    });

    it('encodes the booking code of a customer cancellation', () => {
      TestBed.inject(AppointmentsApi).cancelCustomerAppointment(hostile).subscribe();

      httpTesting.expectOne(`/api/v1/customer/appointments/${encoded}`).flush(null);
    });

    it('leaves ordinary booking codes untouched', () => {
      TestBed.inject(AppointmentsApi).cancelCustomerAppointment('TF-0042').subscribe();

      httpTesting.expectOne('/api/v1/customer/appointments/TF-0042').flush(null);
    });
  });

  describe('AuthApi session endpoints (FE-9)', () => {
    it('marks /me as a public request so a guest 401 is not broadcast as an expiry', () => {
      TestBed.inject(AuthApi)
        .me()
        .subscribe({ error: () => undefined });

      const req = httpTesting.expectOne('/api/v1/auth/me');
      expect(req.request.context.get(PUBLIC_REQUEST)).toBe(true);
      req.flush(null, { status: 401, statusText: 'Unauthorized' });
    });

    it('posts logout as a public request (permitAll on the server)', () => {
      TestBed.inject(AuthApi).logout().subscribe();

      const req = httpTesting.expectOne('/api/v1/auth/logout');
      expect(req.request.method).toBe('POST');
      expect(req.request.context.get(PUBLIC_REQUEST)).toBe(true);
      req.flush(null);
    });
  });

  describe('client-side validation errors (FE-10)', () => {
    it('parseRequest throws a RequestValidationError carrying the first issue message', () => {
      const bad = {
        customerName: 'Jane',
        customerEmail: 'a@b',
        customerPhone: '555',
        barberName: 'Alex',
        bookingDate: '2026-12-01',
        bookingTime: '10:00',
        serviceType: 'Cut',
      };

      let caught: unknown;
      try {
        parseRequest(appointmentCreateSchema, bad);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RequestValidationError);
      expect((caught as RequestValidationError).message).toBe('Invalid email format');
      expect((caught as RequestValidationError).field).toBe('customerEmail');
      expect((caught as RequestValidationError).cause).toBeTruthy();
    });

    it('surfaces the password policy text for a weak registration password', () => {
      let caught: unknown;
      try {
        parseRequest(registerSchema, {
          fullName: 'Jane',
          email: 'jane@example.com',
          password: 'abcdefgh',
          phone: '555',
        });
      } catch (err) {
        caught = err;
      }

      expect((caught as RequestValidationError).field).toBe('password');
      expect((caught as RequestValidationError).message).toContain('letters and numbers');
    });

    it('createAppointment fails with the validation message instead of a generic error', () => {
      let message = '';
      TestBed.inject(AppointmentsApi)
        .createAppointment({
          customerName: 'Jane',
          customerEmail: 'not-an-email',
          customerPhone: '555',
          barberName: 'Alex',
          bookingDate: '2026-12-01',
          bookingTime: '10:00',
          serviceType: 'Cut',
        })
        .subscribe({ error: (err) => (message = extractApiError(err, 'generic')) });

      expect(message).toBe('Invalid email format');
      httpTesting.expectNone('/api/v1/appointments');
    });

    it('extractApiError prefers the server message, then validation text, then the fallback', () => {
      const withBody = new HttpErrorResponse({ status: 400, error: { message: 'Too early' } });
      expect(extractApiError(withBody, 'fallback')).toBe('Too early');
      expect(extractApiError(new RequestValidationError('Bad field', 'x', null), 'fallback')).toBe(
        'Bad field',
      );
      expect(extractApiError(new Error('boom'), 'fallback')).toBe('fallback');
      expect(extractApiError(null, 'fallback')).toBe('fallback');
      expect(extractApiError({ error: { message: '   ' } }, 'fallback')).toBe('fallback');
    });

    it('extractApiError reports a transport failure as unreachable, not "Failed to fetch"', () => {
      const offline = new HttpErrorResponse({
        status: 0,
        error: new TypeError('Failed to fetch'),
      });
      expect(extractApiError(offline, 'fallback')).toBe(NETWORK_ERROR_MESSAGE);
    });
  });
});
