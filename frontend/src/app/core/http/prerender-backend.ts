import { HttpBackend, HttpErrorResponse, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';

/**
 * Prerendering runs at build time, where there is no backend. The stores and the session
 * bootstrap do not request anything on the server; this backend makes sure that nothing that
 * slips through can reach the network either: it fails at once, without a connection attempt.
 */
export class PrerenderBackend implements HttpBackend {
  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    return throwError(
      () =>
        new HttpErrorResponse({
          url: req.urlWithParams,
          status: 0,
          statusText: `No backend while prerendering (${req.method} ${req.urlWithParams})`,
        }),
    );
  }
}
