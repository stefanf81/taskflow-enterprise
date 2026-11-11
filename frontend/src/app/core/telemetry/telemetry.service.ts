import { ErrorHandler, Injectable, InjectionToken, inject } from '@angular/core';
import {
  ClientTelemetry,
  TELEMETRY_ENDPOINT,
  TelemetryEvent,
  TelemetryOptions,
  TelemetryRoute,
  telemetryOptionsFrom,
} from './client-telemetry';
import { observeWebVitals } from './web-vitals';

/** Replaced at build time (`define` in angular.json); undeclared in the unit tests. */
declare const TASKFLOW_TELEMETRY_SAMPLE_RATE: unknown;

export const CLIENT_TELEMETRY_OPTIONS = new InjectionToken<Readonly<TelemetryOptions>>(
  'CLIENT_TELEMETRY_OPTIONS',
  {
    factory: () =>
      telemetryOptionsFrom(
        typeof TASKFLOW_TELEMETRY_SAMPLE_RATE === 'undefined'
          ? undefined
          : TASKFLOW_TELEMETRY_SAMPLE_RATE,
      ),
  },
);

/**
 * keepalive survives the page hide that finalizes LCP and CLS (an XHR is cancelled with the
 * page); credentials 'omit' sends no cookies, since the endpoint is anonymous anyway.
 */
function beacon(event: TelemetryEvent): Promise<unknown> {
  if (typeof fetch !== 'function') return Promise.resolve();
  return fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  readonly client = new ClientTelemetry(beacon, inject(CLIENT_TELEMETRY_OPTIONS));
  private currentRoute: () => TelemetryRoute = () => 'OTHER';

  /**
   * Parent calls once in browser bootstrap. `route` returns the CONFIG route template of the
   * current page (never a URL); `initialRoute` resolves with the page the vitals belong to, the
   * first completed navigation. Uncaught errors reach telemetry through
   * {@link TelemetryErrorHandler} only: provideBrowserGlobalErrorListeners() already forwards
   * window errors and unhandled rejections there, so own listeners would count them twice.
   */
  start(route: () => TelemetryRoute, initialRoute: Promise<TelemetryRoute>): () => void {
    this.currentRoute = route;
    if (!this.client.active || typeof window === 'undefined') return () => undefined;
    return observeWebVitals(this.client, initialRoute, route);
  }

  reportError(): void {
    this.client.reportError('JS_ERROR', this.currentRoute());
  }
}

/** Registered in app.config.ts; counts every error Angular's ErrorHandler receives. */
@Injectable()
export class TelemetryErrorHandler extends ErrorHandler {
  private readonly telemetry = inject(TelemetryService);
  override handleError(error: unknown): void {
    this.telemetry.reportError();
    // Preserve Angular's local developer diagnostics; raw errors never enter telemetry.
    super.handleError(error);
  }
}
