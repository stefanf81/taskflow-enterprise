import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

type AppointmentEventType = 'CREATED' | 'UPDATED' | 'DELETED';

interface AppointmentEventPayload {
  type: AppointmentEventType;
  appointmentId: number;
  occurredAt: string;
}

export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource | null;

export const EVENT_SOURCE_FACTORY = new InjectionToken<EventSourceFactory>('EVENT_SOURCE_FACTORY', {
  factory: () => (url, init) =>
    typeof EventSource === 'undefined' ? null : new EventSource(url, init),
});

/** Owns the admin-only browser event stream without exposing authentication data to JavaScript. */
@Injectable({ providedIn: 'root' })
export class AdminEventsService {
  private readonly eventSourceFactory = inject(EVENT_SOURCE_FACTORY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appointmentChangesSubject = new Subject<void>();
  private source: EventSource | null = null;

  readonly connected = signal(false);
  readonly appointmentChanges: Observable<void> = this.appointmentChangesSubject.asObservable();

  constructor() {
    this.destroyRef.onDestroy(() => this.close());
  }

  connect(): void {
    if (this.source) return;

    const source = this.eventSourceFactory('/api/v1/appointments/events', {
      withCredentials: true,
    });
    if (!source) return;

    this.source = source;
    source.onopen = () => this.connected.set(true);
    source.onerror = () => this.connected.set(false);
    for (const eventName of ['appointment.created', 'appointment.updated', 'appointment.deleted']) {
      source.addEventListener(eventName, (event) => this.handleAppointmentEvent(event));
    }
  }

  close(): void {
    if (!this.source) return;
    this.source.close();
    this.source = null;
    this.connected.set(false);
  }

  private handleAppointmentEvent(event: Event): void {
    if (!(event instanceof MessageEvent) || !this.isAppointmentEvent(event.data)) return;
    this.appointmentChangesSubject.next();
  }

  private isAppointmentEvent(value: unknown): value is AppointmentEventPayload {
    if (typeof value !== 'string') return false;
    try {
      const payload: unknown = JSON.parse(value);
      if (typeof payload !== 'object' || payload === null) return false;
      const event = payload as Record<string, unknown>;
      return (
        (event['type'] === 'CREATED' ||
          event['type'] === 'UPDATED' ||
          event['type'] === 'DELETED') &&
        typeof event['appointmentId'] === 'number' &&
        Number.isFinite(event['appointmentId']) &&
        typeof event['occurredAt'] === 'string'
      );
    } catch {
      return false;
    }
  }
}
