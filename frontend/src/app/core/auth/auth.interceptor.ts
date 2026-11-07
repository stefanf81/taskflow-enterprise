import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { SessionEvents } from '../session-events';
import { AuthState, SessionChangedError } from './auth.state';
import { hasRenewableSession } from './session-hint';

/** Set on the one replay of a request after its 401 led to a session renewal. */
export const SESSION_RENEWED = new HttpContextToken<boolean>(() => false);

// The JWT is stored in an HttpOnly, SameSite=Strict cookie set by the backend.
// The browser automatically attaches it to same-origin /api requests, so the
// interceptor never reads or writes the token in JavaScript (XSS-safe).
//
// Endpoints that are callable without a session mark their requests with the
// PUBLIC_REQUEST context token at the API layer (see core/api/*). A 401 from a
// protected request first tries to renew the session with the HttpOnly refresh
// cookie (only when the readable session hint says one exists) and replays the
// request once. Spring rejects the token before any handler runs, so the replay
// cannot repeat a side effect. When renewal is impossible or the server rejects
// the refresh credential, the 401 is broadcast through SessionEvents so app state
// can react (AuthState clears the in-memory role) without a global DOM event bus.
// A renewal that fails for another reason (offline, timeout, 5xx) keeps the session:
// the caller gets that error, and the next request tries again.
//
// Every request remembers the session it was sent under (SessionEvents.epoch). Once a
// sign-in or sign-out has replaced that session, its 401 is about a session that no
// longer exists here: it neither ends the current one nor renews and replays.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const sessionEvents = inject(SessionEvents);
  const injector = inject(Injector);
  const sentUnder = sessionEvents.epoch();
  const sessionUnchanged = () => sessionEvents.epoch() === sentUnder;

  return next(req).pipe(
    catchError((err) => {
      if (err.status !== 401 || req.context.get(PUBLIC_REQUEST) || !sessionUnchanged()) {
        return throwError(() => err);
      }
      if (req.context.get(SESSION_RENEWED) || !hasRenewableSession()) {
        sessionEvents.notifyUnauthorized();
        return throwError(() => err);
      }
      return injector
        .get(AuthState)
        .renewSession()
        .pipe(
          catchError((renewalErr: unknown) => {
            if (renewalErr instanceof SessionChangedError) return throwError(() => err);
            if ((renewalErr as { status?: number } | null)?.status === 401) {
              sessionEvents.notifyUnauthorized();
              return throwError(() => err);
            }
            return throwError(() => renewalErr);
          }),
          switchMap(() =>
            next(req.clone({ context: req.context.set(SESSION_RENEWED, true) })).pipe(
              catchError((replayErr) => {
                if (replayErr?.status === 401 && sessionUnchanged()) {
                  sessionEvents.notifyUnauthorized();
                }
                return throwError(() => replayErr);
              }),
            ),
          ),
        );
    }),
  );
};
