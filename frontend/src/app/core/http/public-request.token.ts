import { HttpContextToken } from '@angular/common/http';

/**
 * Marks requests that may be issued without an authenticated session.
 *
 * The auth interceptor must not clear client-side session state when one of
 * these returns 401 (e.g. an expired guest booking attempt, or a review
 * submission with a stale cookie). Marking happens at the API layer, next to
 * the endpoint definition — never by URL matching, which silently drifts from
 * the backend security configuration.
 */
export const PUBLIC_REQUEST = new HttpContextToken<boolean>(() => false);
