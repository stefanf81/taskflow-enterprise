import { apiClient } from '../../api/client';
import { ClientTelemetry, TELEMETRY_ENDPOINT, type TelemetryOptions } from './clientTelemetry';

/**
 * Off unless the build sets `EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE` (0 < rate <= 1), the share of app
 * sessions that report. Like the web app, nothing is sent by default.
 */
export function telemetryOptionsFrom(rate: string | undefined): TelemetryOptions {
  const sampleRate = Number(rate ?? '');
  return {
    enabled: Number.isFinite(sampleRate) && sampleRate > 0 && sampleRate <= 1,
    sampleRate,
  };
}

/** The app's telemetry: anonymous, allowlisted events through the public telemetry endpoint. */
export const appTelemetry = new ClientTelemetry(
  (event) => apiClient.post(TELEMETRY_ENDPOINT, event, { timeout: 3000 }),
  telemetryOptionsFrom(process.env.EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE),
);

interface GlobalErrorUtils {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

let installed = false;

/**
 * Counts uncaught JavaScript errors (React Native's global handler), then hands them to the
 * previous handler unchanged (the red box in development, the crash in a release build). The
 * error itself never leaves the device. Render errors arrive through ErrorBoundary instead.
 */
export function installGlobalErrorReporting(telemetry: ClientTelemetry = appTelemetry): void {
  const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (installed || !telemetry.active || !errorUtils) return;
  installed = true;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    telemetry.reportError('JS_ERROR', 'OTHER');
    previous(error, isFatal);
  });
}
