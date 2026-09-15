import { Injectable, signal, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, map, tap, shareReplay } from 'rxjs';
import { LoginResponse } from './types/api';
import { AuthApi } from './core/api/auth-api';
import { SessionEvents } from './core/session-events';

/**
 * A1.2 — Single source of truth for the authenticated UI role.
 *
 * The role is held ONLY in memory (a signal). It is never read from, written to,
 * or trusted from `sessionStorage`/`localStorage`: a client could spoof a stored
 * role and at best reveal admin UI chrome, but the backend remains the real
 * enforcement boundary. After a page refresh the role is re-derived from the
 * server via `me()` (which reads the HttpOnly `access_token` cookie).
 */
@Injectable({ providedIn: 'root' })
export class AuthState {
  private readonly authApi = inject(AuthApi);
  private readonly sessionEvents = inject(SessionEvents);
  private readonly destroyRef = inject(DestroyRef);

  readonly role = signal<string>('');
  readonly isLoggedIn = signal<boolean>(false);
  private bootstrapDone = signal<boolean>(false);
  private bootstrapVersion = 0;

  constructor() {
    // Any 401 on a protected request (raised by the auth interceptor) drops the
    // in-memory session so the UI immediately reflects the logged-out state.
    this.sessionEvents.unauthorized
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clear());
  }

  /**
   * Cached in-flight bootstrap observable. When the auth guard and the App
   * component both call `bootstrap()` during a hard refresh / deep-link, this
   * ensures only a single `me()` HTTP request is issued — both callers share
   * the same result. Reset to null once the bootstrap completes (success or
   * error) so a subsequent explicit `bootstrap()` (e.g. after re-login) starts
   * a fresh request.
   */
  private bootstrap$: Observable<string> | null = null;

  /** Restore the role from the server using the session cookie. Safe to call repeatedly. */
  bootstrap(): Observable<string> {
    // Deduplicate concurrent calls: share a single in-flight request so the
    // auth guard and App.ngOnInit don't fire two `me()` calls on a deep-link.
    if (!this.bootstrap$) {
      const version = ++this.bootstrapVersion;
      this.bootstrap$ = this.authApi.me().pipe(
        map((me: LoginResponse) => me.role),
        tap({
          next: (role) => {
            if (version !== this.bootstrapVersion) return;
            this.applyRole(role);
            this.bootstrapDone.set(true);
            this.bootstrap$ = null;
          },
          error: () => {
            if (version !== this.bootstrapVersion) return;
            this.clear();
            this.bootstrapDone.set(true);
            this.bootstrap$ = null;
          },
        }),
        shareReplay(1),
      );
    }
    return this.bootstrap$;
  }

  applyRole(role: string): void {
    this.role.set(role);
    this.isLoggedIn.set(true);
  }

  clear(): void {
    // A late /me response from a pre-logout bootstrap must not restore auth UI.
    this.bootstrapVersion++;
    this.role.set('');
    this.isLoggedIn.set(false);
    this.bootstrapDone.set(false);
    // Invalidate any in-flight bootstrap so the next bootstrap() starts fresh.
    this.bootstrap$ = null;
  }

  /** Where a user of the given role should land after login / bootstrap. */
  dashboardPathFor(role: string): string {
    if (role === 'ROLE_ADMIN') return '/admin';
    if (role === 'ROLE_CUSTOMER') return '/customer';
    return '';
  }

  isBootstrapDone(): boolean {
    return this.bootstrapDone();
  }
}
