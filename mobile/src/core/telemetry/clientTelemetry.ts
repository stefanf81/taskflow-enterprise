export const TELEMETRY_ENDPOINT = '/api/v1/telemetry';
const ROUTES = ['LANDING', 'BOOKING', 'CUSTOMER', 'ADMIN', 'AUTH', 'OTHER'] as const;
export type TelemetryRoute = (typeof ROUTES)[number];
export type TelemetryError = 'JS_ERROR' | 'UNHANDLED_REJECTION' | 'RENDER_ERROR';
export interface TelemetryEvent {
  platform: 'MOBILE';
  route: TelemetryRoute;
  name: TelemetryError | 'SCREEN_LOAD';
  value: number;
}
export interface TelemetryOptions {
  enabled: boolean;
  sampleRate: number;
}

/** Parent injects the existing first-party API transport after marking the endpoint public.
 * No dependency on auth state, native error hooks, storage or React during module evaluation.
 * At most 20 events per app session, each its own fire-and-forget request (no queue, no retry).
 */
export class ClientTelemetry {
  readonly active: boolean;
  private remaining = 20;

  constructor(
    private readonly send: (event: TelemetryEvent) => Promise<unknown>,
    options: Readonly<TelemetryOptions> = { enabled: false, sampleRate: 0.1 },
    random: () => number = Math.random,
  ) {
    this.active = options.enabled === true && Number.isFinite(options.sampleRate) &&
      options.sampleRate > 0 && options.sampleRate <= 1 && random() < options.sampleRate;
  }

  reportError(name: TelemetryError, route: TelemetryRoute, _error?: unknown): void {
    if (!['JS_ERROR', 'UNHANDLED_REJECTION', 'RENDER_ERROR'].includes(name)) return;
    this.record(name, route, 0);
  }

  screenLoad(route: TelemetryRoute, milliseconds: number): void {
    this.record('SCREEN_LOAD', route, milliseconds);
  }

  private record(name: TelemetryEvent['name'], route: TelemetryRoute, value: number): void {
    if (!this.active || this.remaining <= 0 || !ROUTES.includes(route) ||
      !Number.isFinite(value) || value < 0 || value > 600_000) return;
    this.remaining--;
    try {
      void this.send({ platform: 'MOBILE', route, name, value }).catch(() => undefined);
    } catch {
      // A transport that throws synchronously loses this one event, nothing else.
    }
  }
}
