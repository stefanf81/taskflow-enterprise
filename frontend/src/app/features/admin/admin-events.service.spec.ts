import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  AdminEventsService,
  EVENT_SOURCE_FACTORY,
  EventSourceFactory,
} from './admin-events.service';
import { SessionEvents } from '../../core/session-events';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = FakeEventSource.CONNECTING;
  readonly listeners = new Map<string, EventListener[]>();
  readonly close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }

  /** Simulates the connection being established. */
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  /** The browser gave up for good (e.g. a 429/502/401 response): readyState CLOSED. */
  failPermanently(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }

  /** A transient drop the browser retries by itself: readyState CONNECTING. */
  dropTransiently(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }
}

describe('AdminEventsService', () => {
  let service: AdminEventsService;
  let sources: FakeEventSource[];
  let factory: ReturnType<typeof vi.fn<EventSourceFactory>>;
  const source = (index = 0): FakeEventSource => sources[index] as FakeEventSource;

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    factory = vi.fn<EventSourceFactory>(() => {
      const next = new FakeEventSource();
      sources.push(next);
      return next as unknown as EventSource;
    });
    TestBed.configureTestingModule({
      providers: [{ provide: EVENT_SOURCE_FACTORY, useValue: factory }],
    });
    service = TestBed.inject(AdminEventsService);
  });

  afterEach(() => {
    service.close();
    vi.useRealTimers();
  });

  it('opens a same-origin cookie-authenticated stream once', () => {
    service.connect();
    service.connect();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('/api/v1/appointments/events', {
      withCredentials: true,
    });
  });

  it('emits only valid appointment events', () => {
    const reload = vi.fn();
    service.appointmentChanges.subscribe(reload);
    service.connect();

    source().emit('appointment.created', 'not-json');
    source().emit(
      'appointment.created',
      JSON.stringify({ type: 'CREATED', appointmentId: 42, occurredAt: '2026-08-06T12:00:00Z' }),
    );

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('closes the stream and clears connected state', () => {
    service.connect();
    source().open();
    expect(service.connected()).toBe(true);

    service.close();

    expect(source().close).toHaveBeenCalledOnce();
    expect(service.connected()).toBe(false);
  });

  describe('reconnect (FE-6)', () => {
    it('asks for a full reload after every (re)connect to catch up on missed events', () => {
      const reload = vi.fn();
      service.appointmentChanges.subscribe(reload);
      service.connect();

      source().open();
      expect(reload).toHaveBeenCalledTimes(1);

      source().failPermanently();
      reload.mockClear();
      vi.advanceTimersByTime(1_000);
      source(1).open();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(service.connected()).toBe(true);
    });

    it('reconnects after a permanent failure with exponential backoff capped at 30s', () => {
      service.connect();
      expect(factory).toHaveBeenCalledTimes(1);

      source(0).failPermanently();
      expect(service.connected()).toBe(false);
      vi.advanceTimersByTime(999);
      expect(factory).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(factory).toHaveBeenCalledTimes(2); // after 1s

      source(1).failPermanently();
      vi.advanceTimersByTime(1_999);
      expect(factory).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      expect(factory).toHaveBeenCalledTimes(3); // after 2s

      source(2).failPermanently();
      vi.advanceTimersByTime(4_000);
      expect(factory).toHaveBeenCalledTimes(4); // after 4s

      for (const attempt of [3, 4, 5]) {
        source(attempt).failPermanently();
        vi.advanceTimersByTime(30_000);
        expect(factory).toHaveBeenCalledTimes(attempt + 2);
      }
      // 8s, 16s, 32s -> capped: never waits longer than 30s.
      source(6).failPermanently();
      vi.advanceTimersByTime(29_999);
      expect(factory).toHaveBeenCalledTimes(7);
      vi.advanceTimersByTime(1);
      expect(factory).toHaveBeenCalledTimes(8);
    });

    it('resets the backoff once a connection succeeds', () => {
      service.connect();
      source(0).failPermanently();
      vi.advanceTimersByTime(1_000);
      source(1).failPermanently();
      vi.advanceTimersByTime(2_000);
      source(2).open();

      source(2).failPermanently();
      vi.advanceTimersByTime(1_000);

      expect(factory).toHaveBeenCalledTimes(4);
    });

    it('does not interfere while the browser is retrying a transient drop itself', () => {
      service.connect();

      source().dropTransiently();
      vi.advanceTimersByTime(60_000);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.connected()).toBe(false);
    });

    it('refreshes the list at each failed attempt so an expired session surfaces as a 401', () => {
      const reload = vi.fn();
      service.appointmentChanges.subscribe(reload);
      service.connect();

      source().failPermanently();

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('stops reconnecting once closed', () => {
      service.connect();
      source().failPermanently();

      service.close();
      vi.advanceTimersByTime(120_000);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('stops for good when the server evicts the stream (too many tabs)', () => {
      service.connect();
      source().open();

      source().emit('evicted', 'connection-limit');
      // the browser would auto-reconnect after the close; the client must not, or tabs loop
      source().dropTransiently();
      vi.advanceTimersByTime(60_000);

      expect(source().close).toHaveBeenCalled();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.connected()).toBe(false);
    });

    it('stops reconnecting when the session ends (logout)', () => {
      service.connect();
      source().failPermanently();

      TestBed.inject(SessionEvents).notifySessionEnded();
      vi.advanceTimersByTime(120_000);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('stops reconnecting on a 401 elsewhere in the app', () => {
      service.connect();
      source().failPermanently();

      TestBed.inject(SessionEvents).notifyUnauthorized();
      vi.advanceTimersByTime(120_000);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('can be connected again after being closed', () => {
      service.connect();
      service.close();

      service.connect();

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('stops reconnecting when the service is destroyed', () => {
      service.connect();
      source().failPermanently();

      TestBed.resetTestingModule();
      vi.advanceTimersByTime(120_000);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('does nothing when EventSource is unavailable', () => {
      factory.mockReturnValue(null);

      service.connect();
      vi.advanceTimersByTime(60_000);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.connected()).toBe(false);
    });
  });
});
