import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * App-wide auth lifecycle events.
 *
 * Replaces the previous `window.dispatchEvent(new CustomEvent('auth:unauthorized'))`
 * bus: an injectable keeps the publish/subscribe contract typed, unit-testable
 * and SSR-safe (no global DOM dependency).
 */
@Injectable({ providedIn: 'root' })
export class SessionEvents {
  private readonly unauthorizedSubject = new Subject<void>();

  /** Emits whenever the backend rejects a protected request with 401. */
  readonly unauthorized: Observable<void> = this.unauthorizedSubject.asObservable();

  notifyUnauthorized(): void {
    this.unauthorizedSubject.next();
  }
}
