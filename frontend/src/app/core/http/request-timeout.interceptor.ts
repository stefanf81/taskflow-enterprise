import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Upper bound for one API request, as on mobile (`mobile/src/api/client.ts`). It stays above the
 * server's own worst case (5 s JPA query timeout + 4 s Hikari connection timeout, BENCHMARKS §45),
 * so a slow backend still answers with its own error before the browser gives up.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Without a timeout a request to a hung backend or a half-open connection stays pending until the
 * browser gives up, minutes later, and the screen keeps its spinner. Every HttpClient request
 * (including `httpResource`) gets {@link DEFAULT_REQUEST_TIMEOUT_MS} unless it sets its own
 * `timeout`. On expiry the backend aborts the request and fails it with an `HttpErrorResponse` of
 * status 0, which the existing error handling already treats as "cannot reach the server". The
 * admin event stream uses `EventSource`, not HttpClient, so it is not cut off.
 */
export const requestTimeoutInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.timeout ? req : req.clone({ timeout: DEFAULT_REQUEST_TIMEOUT_MS }));
