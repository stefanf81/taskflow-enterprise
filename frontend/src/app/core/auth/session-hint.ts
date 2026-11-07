/**
 * The readable cookie the server sets next to the HttpOnly refresh credential. It carries no
 * secret, only "this browser can renew its session"; the credential itself never reaches
 * JavaScript. Without it every guest page load would have to probe the refresh endpoint.
 */
export const SESSION_HINT_COOKIE = 'taskflow_session';

/** Whether this browser holds a refresh session it may renew (false while prerendering). */
export function hasRenewableSession(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .some(
      (part) =>
        part.startsWith(`${SESSION_HINT_COOKIE}=`) && part.length > SESSION_HINT_COOKIE.length + 1,
    );
}
