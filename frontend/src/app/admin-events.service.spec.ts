import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import {
  AdminEventsService,
  EVENT_SOURCE_FACTORY,
  EventSourceFactory,
} from './admin-events.service';

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, EventListener[]>();
  readonly close = vi.fn();

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

describe('AdminEventsService', () => {
  let service: AdminEventsService;
  let source: FakeEventSource;
  let factory: ReturnType<typeof vi.fn<EventSourceFactory>>;

  beforeEach(() => {
    source = new FakeEventSource();
    factory = vi.fn<EventSourceFactory>(() => source as unknown as EventSource);
    TestBed.configureTestingModule({
      providers: [{ provide: EVENT_SOURCE_FACTORY, useValue: factory }],
    });
    service = TestBed.inject(AdminEventsService);
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

    source.emit('appointment.created', 'not-json');
    source.emit(
      'appointment.created',
      JSON.stringify({ type: 'CREATED', appointmentId: 42, occurredAt: '2026-08-06T12:00:00Z' }),
    );

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('closes the stream and clears connected state', () => {
    service.connect();
    source.onopen?.();
    expect(service.connected()).toBe(true);

    service.close();

    expect(source.close).toHaveBeenCalledOnce();
    expect(service.connected()).toBe(false);
  });
});
