import { HttpErrorResponse } from '@angular/common/http';
import { RequestValidationError } from './request-validation';

/** Shown when the request never reached the server (offline, DNS, CORS, proxy down). */
export const NETWORK_ERROR_MESSAGE =
  'Cannot reach the server. Please check your connection and try again.';

/**
 * Extracts a user-facing message from an HTTP error.
 *
 * Precedence: transport failure (status 0) -> the backend's `{ message }` body
 * -> a client-side {@link RequestValidationError} (first zod issue, e.g.
 * "Invalid email format") -> the caller's fallback copy. Centralized so all call
 * sites surface errors consistently instead of hand-rolling the same cast.
 */
export function extractApiError(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) {
    return NETWORK_ERROR_MESSAGE;
  }
  const detail = (err as { error?: { message?: unknown } })?.error?.message;
  if (typeof detail === 'string' && detail.trim().length > 0) {
    return detail;
  }
  if (err instanceof RequestValidationError) {
    return err.message;
  }
  return fallback;
}
