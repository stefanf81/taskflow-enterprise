import { describe, expect, it, vi } from 'vitest';
import { ClientTelemetry, TelemetryEvent, telemetryRoute } from './client-telemetry';

const enabled = { enabled: true, sampleRate: 1 };

describe('ClientTelemetry', () => {
  it('is off unless enabled and sampled', () => {
    const send = vi.fn(() => Promise.resolve());
    new ClientTelemetry(send).performance('LCP', 'LANDING', 1200);
    new ClientTelemetry(send, { enabled: true, sampleRate: 0.1 }, () => 0.5).performance(
      'LCP',
      'LANDING',
      1200,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a closed payload and never forwards the raw error', () => {
    const events: TelemetryEvent[] = [];
    const telemetry = new ClientTelemetry((event) => {
      events.push(event);
      return Promise.resolve();
    }, enabled);

    telemetry.reportError('JS_ERROR', 'ADMIN', new Error('secret customer@example.com'));

    expect(events).toEqual([{ platform: 'WEB', route: 'ADMIN', name: 'JS_ERROR', value: 0 }]);
  });

  it('sends events that are recorded together (LCP and CLS at page hide) without waiting', () => {
    const send = vi.fn(() => new Promise<void>(() => undefined));
    const telemetry = new ClientTelemetry(send, enabled);

    telemetry.performance('LCP', 'BOOKING', 1800);
    telemetry.performance('CLS', 'BOOKING', 0.05);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('bounds the events per page load and drops implausible values', () => {
    const send = vi.fn(() => Promise.resolve());
    const telemetry = new ClientTelemetry(send, enabled);

    telemetry.performance('CLS', 'LANDING', 11);
    telemetry.performance('LCP', 'LANDING', -1);
    telemetry.performance('LCP', 'LANDING', Number.NaN);
    expect(send).not.toHaveBeenCalled();

    for (let i = 0; i < 25; i++) telemetry.performance('FCP', 'LANDING', 100);
    expect(send).toHaveBeenCalledTimes(20);
  });

  it('survives a transport that throws or rejects', () => {
    const throwing = new ClientTelemetry(() => {
      throw new Error('offline');
    }, enabled);
    expect(() => throwing.performance('FCP', 'LANDING', 100)).not.toThrow();

    const rejecting = new ClientTelemetry(() => Promise.reject(new Error('offline')), enabled);
    expect(() => rejecting.performance('FCP', 'LANDING', 100)).not.toThrow();
  });

  it('maps route config templates, never URLs', () => {
    expect(telemetryRoute('')).toBe('LANDING');
    expect(telemetryRoute('customer/book')).toBe('BOOKING');
    expect(telemetryRoute('admin')).toBe('ADMIN');
    expect(telemetryRoute('/customer?ref=abc')).toBe('OTHER');
  });
});
