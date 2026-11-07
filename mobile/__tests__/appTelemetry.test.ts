import { ClientTelemetry } from '../src/core/telemetry/clientTelemetry';
import { installGlobalErrorReporting, telemetryOptionsFrom } from '../src/core/telemetry/appTelemetry';

describe('mobile telemetry', () => {
  it('stays off unless the build sets a sample rate in (0, 1]', () => {
    expect(telemetryOptionsFrom(undefined).enabled).toBe(false);
    expect(telemetryOptionsFrom('').enabled).toBe(false);
    expect(telemetryOptionsFrom('0').enabled).toBe(false);
    expect(telemetryOptionsFrom('1.5').enabled).toBe(false);
    expect(telemetryOptionsFrom('abc').enabled).toBe(false);
    expect(telemetryOptionsFrom('0.25')).toEqual({ enabled: true, sampleRate: 0.25 });
  });

  it('sends a closed MOBILE payload and never the error itself', () => {
    const send = jest.fn(() => Promise.resolve());
    const telemetry = new ClientTelemetry(send, { enabled: true, sampleRate: 1 });

    telemetry.reportError('RENDER_ERROR', 'OTHER', new Error('jane@example.com'));
    telemetry.screenLoad('BOOKING', 820);

    expect(send).toHaveBeenNthCalledWith(1, {
      platform: 'MOBILE',
      route: 'OTHER',
      name: 'RENDER_ERROR',
      value: 0,
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      platform: 'MOBILE',
      route: 'BOOKING',
      name: 'SCREEN_LOAD',
      value: 820,
    });
  });

  it('counts uncaught errors and still hands them to the previous global handler', () => {
    const previous = jest.fn();
    let handler: ((error: unknown, isFatal?: boolean) => void) | undefined;
    const errorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (next: typeof handler) => {
        handler = next;
      },
    };
    const original = (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = errorUtils;
    const send = jest.fn(() => Promise.resolve());
    try {
      installGlobalErrorReporting(new ClientTelemetry(send, { enabled: true, sampleRate: 1 }));
      const error = new Error('boom');
      handler?.(error, true);

      expect(send).toHaveBeenCalledWith({ platform: 'MOBILE', route: 'OTHER', name: 'JS_ERROR', value: 0 });
      expect(previous).toHaveBeenCalledWith(error, true);
    } finally {
      (globalThis as { ErrorUtils?: unknown }).ErrorUtils = original;
    }
  });
});
