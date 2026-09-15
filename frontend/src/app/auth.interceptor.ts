import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { PUBLIC_REQUEST } from './core/http/public-request.token';
import { SessionEvents } from './core/session-events';

// The JWT is stored in an HttpOnly, SameSite=Strict cookie set by the backend.
// The browser automatically attaches it to same-origin /api requests, so the
// interceptor never reads or writes the token in JavaScript (XSS-safe).
//
// Endpoints that are callable without a session mark their requests with the
// PUBLIC_REQUEST context token at the API layer (see core/api/*). A 401 from a
// protected request is broadcast through SessionEvents so app state can react
// (AuthState clears the in-memory role) without a global DOM event bus.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const sessionEvents = inject(SessionEvents);

  return next(req).pipe(
    catchError((err) => {
      if (err.status === 401 && !req.context.get(PUBLIC_REQUEST)) {
        sessionEvents.notifyUnauthorized();
      }
      return throwError(() => err);
    }),
  );
};
