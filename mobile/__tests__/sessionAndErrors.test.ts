import { getApiErrorMessage, getHttpStatus, getRetryAfterSeconds } from '../src/utils/errors';
import {
  EXPIRY_SKEW_MS,
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  computeExpiryMs,
  isTokenExpired,
} from '../src/utils/session';
import { isPublicEndpoint } from '../src/api/publicEndpoints';
import { normalizePublicId } from '../src/utils/publicId';

describe('utils/errors', () => {
  const http = (status: number, data: unknown = {}, headers: Record<string, unknown> = {}) => ({
    response: { status, data, headers },
  });

  it('returns the HTTP status or undefined', () => {
    expect(getHttpStatus(http(409))).toBe(409);
    expect(getHttpStatus(new Error('x'))).toBeUndefined();
    expect(getHttpStatus(null)).toBeUndefined();
  });

  it('parses Retry-After as seconds or as an HTTP date', () => {
    expect(getRetryAfterSeconds(http(429, {}, { 'Retry-After': '30' }))).toBe(30);
    expect(getRetryAfterSeconds(http(429, {}, { 'retry-after': ' 0 ' }))).toBe(1);
    const now = Date.parse('2026-08-12T10:00:00Z');
    expect(
      getRetryAfterSeconds(http(429, {}, { 'retry-after': 'Wed, 12 Aug 2026 10:01:00 GMT' }), now),
    ).toBe(60);
    expect(getRetryAfterSeconds(http(429, {}, { 'retry-after': 'garbage' }))).toBeNull();
    expect(getRetryAfterSeconds(http(429))).toBeNull();
    expect(getRetryAfterSeconds(new Error('x'))).toBeNull();
  });

  it('formats 429 as "Too many attempts, try again in N s"', () => {
    expect(getApiErrorMessage(http(429, {}, { 'retry-after': '17' }), 'x')).toBe(
      'Too many attempts, try again in 17 s',
    );
    expect(getApiErrorMessage(http(429), 'x')).toBe('Too many attempts, try again later');
  });

  it('prefers the server message, then 503 hint, Error message, fallback', () => {
    expect(getApiErrorMessage(http(400, { message: 'No past bookings' }), 'x')).toBe(
      'No past bookings',
    );
    expect(getApiErrorMessage(http(409, { message: '  ' }), 'fallback')).toBe('fallback');
    expect(getApiErrorMessage(http(503, null), 'x')).toMatch(/temporarily unavailable/);
    expect(getApiErrorMessage(new Error('Network Error'), 'x')).toBe('Network Error');
    expect(getApiErrorMessage({}, 'fallback')).toBe('fallback');
    expect(getApiErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('utils/session', () => {
  it('computes an absolute expiry from expiresIn seconds', () => {
    expect(computeExpiryMs(3600, 1_000)).toBe(1_000 + 3_600_000);
  });

  it('is expired at or inside the skew margin, never when unknown', () => {
    const exp = 100_000;
    expect(isTokenExpired(null, 999_999_999)).toBe(false);
    expect(isTokenExpired(exp, exp - EXPIRY_SKEW_MS - 1)).toBe(false);
    expect(isTokenExpired(exp, exp - EXPIRY_SKEW_MS)).toBe(true);
    expect(isTokenExpired(exp, exp + 1)).toBe(true);
    expect(isTokenExpired(exp, exp - 1, 0)).toBe(false);
  });

  it('SessionExpiredError carries the user-facing message', () => {
    const err = new SessionExpiredError();
    expect(err.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(err.name).toBe('SessionExpiredError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('api/publicEndpoints', () => {
  it.each([
    ['post', '/api/v1/auth/mobile/login'],
    ['POST', '/api/v1/auth/login'],
    ['post', '/api/v1/auth/register'],
    ['post', '/api/v1/appointments'],
    ['post', '/api/v1/appointments/'],
    ['get', '/api/v1/appointments/public/busy-slots?barberName=A&bookingDate=2026-08-12'],
    ['put', '/api/v1/appointments/public/cancel/abc'],
    ['get', '/api/v1/catalog'],
    ['get', '/api/v1/catalog/5'],
    ['get', '/api/v1/barbers'],
    ['get', '/api/v1/reviews/public/barber-ratings'],
    ['post', '/api/v1/reviews/public/abc'],
    [undefined, '/api/v1/catalog'],
    ['get', 'https://api.example.com/api/v1/catalog'],
  ])('%s %s is public', (method, url) => {
    expect(isPublicEndpoint(method as string | undefined, url)).toBe(true);
  });

  it.each([
    ['get', '/api/v1/appointments'],
    ['put', '/api/v1/appointments/5'],
    ['delete', '/api/v1/appointments/5'],
    ['get', '/api/v1/appointments/public/cancel/abc'],
    ['put', '/api/v1/appointments/public/cancel/a/b'],
    ['post', '/api/v1/catalog'],
    ['delete', '/api/v1/catalog/1'],
    ['get', '/api/v1/barbers/admin'],
    ['get', '/api/v1/barbers/1/time-off'],
    ['post', '/api/v1/barbers/1/time-off'],
    ['get', '/api/v1/auth/me'],
    ['post', '/api/v1/auth/logout'],
    ['get', '/api/v1/customer/appointments'],
    ['delete', '/api/v1/customer/appointments/abc'],
    ['get', '/api/v1/notifications'],
    ['get', undefined],
    ['get', ''],
  ])('%s %s is protected', (method, url) => {
    expect(isPublicEndpoint(method as string, url as string | undefined)).toBe(false);
  });
});

describe('utils/publicId', () => {
  it('trims and lower-cases', () => {
    expect(normalizePublicId('  123E4567-E89B-12D3-A456-426614174000\n')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });
});
