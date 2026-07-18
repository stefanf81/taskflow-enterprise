import { HttpInterceptorFn } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

// The JWT is now stored in an HttpOnly, SameSite=Strict cookie set by the backend.
// The browser automatically attaches it to same-origin /api requests, so the
// interceptor no longer reads or writes the token in JavaScript (XSS-safe).
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Login is unauthenticated; everything else rides on the cookie.
  if (req.url.includes('/api/v1/auth/login')) {
    return next(req);
  }

  return next(req).pipe(
    catchError((err) => {
      if (err.status === 401) {
        // Notify the app to drop its client-side auth state. No redirect to
        // avoid infinite loops on public endpoints.
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
      return throwError(() => err);
    }),
  );
};
