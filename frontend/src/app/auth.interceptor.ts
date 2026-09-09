import { HttpInterceptorFn } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

function isPublicRequest(req: { method: string; url: string }): boolean {
  const path = new URL(req.url, window.location.origin).pathname;

  return (
    (req.method === 'POST' &&
      (path === '/api/v1/auth/login' ||
        path === '/api/v1/auth/register' ||
        path === '/api/v1/appointments' ||
        path.startsWith('/api/v1/reviews/public/'))) ||
    (req.method === 'PUT' && path.startsWith('/api/v1/appointments/public/cancel/')) ||
    (req.method === 'GET' &&
      (path === '/api/v1/auth/csrf' ||
        path === '/api/v1/catalog' ||
        path.startsWith('/api/v1/catalog/') ||
        path === '/api/v1/barbers' ||
        path === '/api/v1/appointments/public/busy-slots' ||
        path.startsWith('/api/v1/reviews/public/')))
  );
}

// The JWT is now stored in an HttpOnly, SameSite=Strict cookie set by the backend.
// The browser automatically attaches it to same-origin /api requests, so the
// interceptor no longer reads or writes the token in JavaScript (XSS-safe).
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((err) => {
      if (err.status === 401 && !isPublicRequest(req)) {
        // Notify the app to drop its client-side auth state. No redirect to
        // avoid infinite loops. Public routes must never erase a valid session.
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
      return throwError(() => err);
    }),
  );
};
