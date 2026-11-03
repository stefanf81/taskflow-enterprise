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
  private readonly sessionEndedSubject = new Subject<void>();
  private readonly sessionStartedSubject = new Subject<void>();

  /** Emits whenever the backend rejects a protected request with 401. */
  readonly unauthorized: Observable<void> = this.unauthorizedSubject.asObservable();

  /**
   * Emits when an AUTHENTICATED session ends in this tab (logout, expiry). Stores
   * subscribe to drop per-user state (pages, filters, banners, contact details)
   * so nothing leaks to the next visitor on a shared device. It does not fire for
   * a guest whose boot-time `/auth/me` simply answered "no session".
   */
  readonly sessionEnded: Observable<void> = this.sessionEndedSubject.asObservable();

  /**
   * Emits when someone signs in in this tab (`AuthState.applyRole`), before the login modal hands
   * over to the dashboard. A guest's leftovers (the banner of a failed cancel or review) must not
   * follow the user in. It does not fire for a session restored at boot by `/auth/me`.
   */
  readonly sessionStarted: Observable<void> = this.sessionStartedSubject.asObservable();

  notifyUnauthorized(): void {
    this.unauthorizedSubject.next();
  }

  notifySessionEnded(): void {
    this.sessionEndedSubject.next();
  }

  notifySessionStarted(): void {
    this.sessionStartedSubject.next();
  }
}
