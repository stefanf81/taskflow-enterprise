import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, merge } from 'rxjs';
import { appointmentEventSchema } from '@taskflow/schemas';
import { SessionEvents } from '../../core/session-events';

export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource | null;

export const EVENT_SOURCE_FACTORY = new InjectionToken<EventSourceFactory>('EVENT_SOURCE_FACTORY', {
  factory: () => (url, init) =>
    typeof EventSource === 'undefined' ? null : new EventSource(url, init),
});

/** `EventSource.CLOSED`: the browser gave up (non-200 response, wrong content type, 401...). */
const READY_STATE_CLOSED = 2;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Owns the admin-only browser event stream without exposing authentication data to JavaScript.
 *
 * Resilience: when the connection drops the browser retries by itself, but an
 * `EventSource` that failed with a non-200 response (429, 502, 401...) is CLOSED
 * permanently — it never retries. This service then reconnects with exponential
 * backoff (1s, 2s, 4s ... capped at 30s) until it is closed explicitly, the
 * service is destroyed, the session ends (logout / 401 elsewhere), or the server
 * sends `evicted` (this stream was replaced because the admin opened too many tabs).
 *
 * Events can be missed while there is no stream, so `appointmentChanges` also emits a
 * "reload everything" tick on every open but the first (that one is skipped: `AppointmentStore`'s
 * reactive mount load is already in flight), and once per failed attempt (which doubles as a
 * cheap session probe: if the cookie expired, the HTTP reload gets a 401 and the normal
 * session-expiry flow takes over).
 */
@Injectable({ providedIn: 'root' })
export class AdminEventsService {
  private readonly eventSourceFactory = inject(EVENT_SOURCE_FACTORY);
  private readonly sessionEvents = inject(SessionEvents);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appointmentChangesSubject = new Subject<void>();
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** True once a stream has been open in this tab: every open after it needs a catch-up. */
  private everOpened = false;
  /** True between connect() and close(): the only state in which reconnecting is allowed. */
  private wanted = false;

  readonly connected = signal(false);
  /** Emits when the appointment list should be refetched (an event, or a catch-up after reconnect). */
  readonly appointmentChanges: Observable<void> = this.appointmentChangesSubject.asObservable();

  constructor() {
    this.destroyRef.onDestroy(() => this.close());
    // A dead or ended session must never keep a reconnect loop alive.
    merge(this.sessionEvents.sessionEnded, this.sessionEvents.unauthorized)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());
  }

  connect(): void {
    this.wanted = true;
    if (this.source || this.reconnectTimer) return;
    this.open();
  }

  close(): void {
    this.wanted = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.source) return;
    this.source.close();
    this.source = null;
    this.connected.set(false);
  }

  private open(): void {
    const source = this.eventSourceFactory('/api/v1/appointments/events', {
      withCredentials: true,
    });
    if (!source) return;

    this.source = source;
    source.onopen = () => {
      // Anything that happened while there was no stream is lost, so every open but the very
      // first catches up. Only that first one can be skipped: it rides along with
      // AppointmentStore's reactive mount load. Every later one — a reconnect, or the dashboard
      // being entered again after close() tore the stream down — finds the root-provided store
      // holding whatever it last loaded, with nothing else to refetch it.
      const shouldCatchUp = this.everOpened;
      this.everOpened = true;
      this.reconnectAttempts = 0;
      this.connected.set(true);
      if (shouldCatchUp) {
        this.appointmentChangesSubject.next();
      }
    };
    source.onerror = () => {
      this.connected.set(false);
      if (source.readyState === READY_STATE_CLOSED) {
        this.handleClosed(source);
      }
      // CONNECTING: the browser is already retrying on its own.
    };
    for (const eventName of ['appointment.created', 'appointment.updated', 'appointment.deleted']) {
      source.addEventListener(eventName, (event) => this.handleAppointmentEvent(event));
    }
    // The server replaced this stream (another tab of the same admin hit the connection limit).
    // Stop for good: the browser would otherwise reconnect after the close and evict the other
    // tab in turn, looping forever.
    source.addEventListener('evicted', () => {
      if (this.source === source) this.close();
    });
  }

  private handleClosed(source: EventSource): void {
    if (this.source !== source) return;
    source.close();
    this.source = null;
    if (!this.wanted) return;

    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.open();
    }, delay);
    // Keep the list fresh (and probe the session) while the stream is down.
    this.appointmentChangesSubject.next();
  }

  private handleAppointmentEvent(event: Event): void {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return;
    if (!this.isAppointmentEvent(event.data)) return;
    this.appointmentChangesSubject.next();
  }

  /** Validates the SSE payload against the shared zod contract. */
  private isAppointmentEvent(data: string): boolean {
    try {
      return appointmentEventSchema.safeParse(JSON.parse(data)).success;
    } catch {
      return false;
    }
  }
}
