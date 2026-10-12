/** Bearer-token lifetime helpers (MobileLoginResponse.expiresIn is in seconds). */

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

/** Treat the token as expired slightly early so it is not rejected in flight. */
export const EXPIRY_SKEW_MS = 5000;

/** Absolute expiry (epoch ms) for a token issued now with `expiresInSeconds` lifetime. */
export function computeExpiryMs(expiresInSeconds: number, now: number = Date.now()): number {
  return now + expiresInSeconds * 1000;
}

/** True when a known expiry has passed. An unknown expiry (null) is never "expired". */
export function isTokenExpired(
  expiresAtMs: number | null,
  now: number = Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return expiresAtMs !== null && now >= expiresAtMs - skewMs;
}

/** Raised (before the request is sent) when the stored bearer token is past its expiry. */
export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = 'SessionExpiredError';
  }
}
