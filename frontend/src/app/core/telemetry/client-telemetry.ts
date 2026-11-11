export const TELEMETRY_ENDPOINT = '/api/v1/telemetry';
export const TELEMETRY_ROUTES = [
  'LANDING',
  'BOOKING',
  'CUSTOMER',
  'ADMIN',
  'AUTH',
  'OTHER',
] as const;
export type TelemetryRoute = (typeof TELEMETRY_ROUTES)[number];
export type TelemetryError = 'JS_ERROR' | 'UNHANDLED_REJECTION' | 'RENDER_ERROR';
export type TelemetryPerformance = 'LCP' | 'FCP' | 'CLS' | 'INP' | 'SCREEN_LOAD';
export interface TelemetryEvent {
  platform: 'WEB';
  route: TelemetryRoute;
  name: TelemetryError | TelemetryPerformance;
  value: number;
}
export interface TelemetryOptions {
  enabled: boolean;
  sampleRate: number;
}
export const DEFAULT_TELEMETRY_OPTIONS: Readonly<TelemetryOptions> = Object.freeze({
  enabled: false,
  sampleRate: 0.1,
});

/**
 * Off unless the build sets the sample rate (0 < rate <= 1, the share of page loads that report),
 * like mobile's `EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE`: `angular.json` defines
 * `TASKFLOW_TELEMETRY_SAMPLE_RATE` as 0, and a deployment that wants measurements builds with
 * `ng build --define TASKFLOW_TELEMETRY_SAMPLE_RATE=0.1`. Anything else keeps it off.
 */
export function telemetryOptionsFrom(rate: unknown): Readonly<TelemetryOptions> {
  const sampleRate = typeof rate === 'number' || typeof rate === 'string' ? Number(rate) : NaN;
  return Number.isFinite(sampleRate) && sampleRate > 0 && sampleRate <= 1
    ? Object.freeze({ enabled: true, sampleRate })
    : DEFAULT_TELEMETRY_OPTIONS;
}

/** Accept route CONFIG templates only, never router.url, location.href or URL parameters. */
export function telemetryRoute(template: string): TelemetryRoute {
  switch (template) {
    case '':
      return 'LANDING';
    case 'customer/book':
      return 'BOOKING';
    case 'customer':
      return 'CUSTOMER';
    case 'admin':
      return 'ADMIN';
    default:
      return 'OTHER';
  }
}

/**
 * No IDs, persistence, queues, retries, raw errors, stacks or external SDK. At most 20 events per
 * page load leave the browser, each its own fire-and-forget request (page hide sends LCP and CLS
 * together, so an in-flight gate would drop one of them).
 */
export class ClientTelemetry {
  readonly active: boolean;
  private remaining = 20;

  constructor(
    private readonly send: (event: TelemetryEvent) => Promise<unknown>,
    options: Readonly<TelemetryOptions> = DEFAULT_TELEMETRY_OPTIONS,
    random: () => number = Math.random,
  ) {
    this.active =
      options.enabled === true &&
      Number.isFinite(options.sampleRate) &&
      options.sampleRate > 0 &&
      options.sampleRate <= 1 &&
      random() < options.sampleRate;
  }

  reportError(name: TelemetryError, route: TelemetryRoute, _error?: unknown): void {
    if (!['JS_ERROR', 'UNHANDLED_REJECTION', 'RENDER_ERROR'].includes(name)) return;
    this.record(name, route, 0);
  }

  performance(name: TelemetryPerformance, route: TelemetryRoute, value: number): void {
    if (!['LCP', 'FCP', 'CLS', 'INP', 'SCREEN_LOAD'].includes(name)) return;
    this.record(name, route, value);
  }

  private record(name: TelemetryEvent['name'], route: TelemetryRoute, value: number): void {
    if (
      !this.active ||
      this.remaining <= 0 ||
      !TELEMETRY_ROUTES.includes(route) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > (name === 'CLS' ? 10 : 600_000)
    )
      return;
    this.remaining--;
    // Reconstruct a closed object: never spread caller-supplied values into the wire payload.
    try {
      void this.send({ platform: 'WEB', route, name, value }).catch(() => undefined);
    } catch {
      // A transport that throws synchronously loses this one event, nothing else.
    }
  }
}
