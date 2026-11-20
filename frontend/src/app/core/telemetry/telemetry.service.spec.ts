import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_TELEMETRY_OPTIONS, TelemetryService } from './telemetry.service';

/** Records what the Web Vitals module observes, instead of the browser's PerformanceObserver. */
class RecordingObserver {
  static observed: string[] = [];
  static disconnected = 0;
  static readonly supportedEntryTypes = ['paint', 'largest-contentful-paint', 'layout-shift'];
  observe(options: { type: string }): void {
    RecordingObserver.observed.push(options.type);
  }
  disconnect(): void {
    RecordingObserver.disconnected++;
  }
}

/** The observer module is loaded with a dynamic import: give it a few turns to arrive. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
}

describe('TelemetryService.start', () => {
  const original = globalThis.PerformanceObserver;

  beforeEach(() => {
    RecordingObserver.observed = [];
    RecordingObserver.disconnected = 0;
    (globalThis as { PerformanceObserver: unknown }).PerformanceObserver = RecordingObserver;
  });

  afterEach(() => {
    (globalThis as { PerformanceObserver: unknown }).PerformanceObserver = original;
  });

  function service(enabled: boolean): TelemetryService {
    TestBed.configureTestingModule({
      providers: [
        { provide: CLIENT_TELEMETRY_OPTIONS, useValue: { enabled, sampleRate: enabled ? 1 : 0 } },
      ],
    });
    return TestBed.inject(TelemetryService);
  }

  it('loads the Web Vitals observers lazily when telemetry is on, and stops them', async () => {
    const stop = service(true).start(() => 'LANDING', Promise.resolve('LANDING'));
    await settle();

    expect(RecordingObserver.observed).toEqual(
      expect.arrayContaining(['paint', 'largest-contentful-paint', 'layout-shift']),
    );
    stop();
    expect(RecordingObserver.disconnected).toBe(RecordingObserver.observed.length);
  });

  it('starts nothing when stopped before the observer module arrived', async () => {
    const stop = service(true).start(() => 'LANDING', Promise.resolve('LANDING'));
    stop();
    await settle();

    expect(RecordingObserver.observed).toEqual([]);
  });

  it('observes nothing when telemetry is off (the default build)', async () => {
    service(false).start(() => 'LANDING', Promise.resolve('LANDING'));
    await settle();

    expect(RecordingObserver.observed).toEqual([]);
  });
});
