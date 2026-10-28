import { Injectable, signal, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  firstValueFrom,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { LoginResponse } from '../../types/api';
import { AuthApi } from '../api/auth-api';
import { SessionEvents } from '../session-events';

/** Notice shown (in the login modal) after a protected request found the session dead. */
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly role = signal<string>('');
  /** The authenticated principal's username (the customer's email); '' for guests. */
  readonly username = signal<string>('');
  readonly isLoggedIn = signal<boolean>(false);
  /** A "your session expired" notice waiting to be shown by the login modal. */
  readonly sessionNotice = signal<string | null>(null);
  /** Set when the landing page should open the login modal; the landing page resets it. */
  readonly loginPromptRequested = signal<boolean>(false);
  private bootstrapDone = signal<boolean>(false);
  private bootstrapVersion = 0;

  constructor() {
    // A 401 on a protected request (raised by the auth interceptor) means the
    // session died server-side (expiry, revocation, key rotation). Drop the
    // in-memory session AND take the user somewhere sensible: back to the
    // landing page with a notice and the login modal open. Only an authenticated
    // session can "expire"; a stray 401 for a guest is ignored.
    this.sessionEvents.unauthorized.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.isLoggedIn()) return;
      this.clear();
      this.sessionNotice.set(SESSION_EXPIRED_MESSAGE);
      this.loginPromptRequested.set(true);
      void this.router.navigateByUrl('/');
    });
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

  /**
   * Restore the role from the server using the session cookie. Safe to call repeatedly.
   *
   * `me()` is a PUBLIC request, so a guest's 401 is handled here (not by the
   * interceptor): it completes the bootstrap as "no session". A result that
   * arrives after the state moved on (login, logout, clear) is ignored via
   * `bootstrapVersion`, so a slow `/me` can neither wipe a newer login nor
   * resurrect a signed-out session.
   */
  bootstrap(): Observable<string> {
    // Deduplicate concurrent calls: share a single in-flight request so the
    // auth guard and App.ngOnInit don't fire two `me()` calls on a deep-link.
    if (!this.bootstrap$) {
      const version = ++this.bootstrapVersion;
      this.bootstrap$ = this.authApi.me().pipe(
        tap({
          next: (me: LoginResponse) => {
            if (version !== this.bootstrapVersion) return;
            this.setPrincipal(me.role, me.username);
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
        map((me: LoginResponse) => me.role),
        shareReplay(1),
      );
    }
    return this.bootstrap$;
  }

  /** Records a successful login (or an explicit session restore). */
  applyRole(role: string, username = ''): void {
    // A newer login supersedes any bootstrap still in flight: its (possibly 401) answer
    // describes the session BEFORE this login and must not be applied.
    this.bootstrapVersion++;
    this.bootstrap$ = null;
    this.setPrincipal(role, username);
    this.bootstrapDone.set(true);
    this.sessionNotice.set(null);
  }

  private setPrincipal(role: string, username: string): void {
    this.role.set(role);
    this.username.set(username);
    this.isLoggedIn.set(true);
  }

  clear(): void {
    const hadSession = this.isLoggedIn();
    // A late /me response from a pre-logout bootstrap must not restore auth UI.
    this.bootstrapVersion++;
    this.role.set('');
    this.username.set('');
    this.isLoggedIn.set(false);
    // We now KNOW there is no session, so guarded navigations must not re-ask the server.
    this.bootstrapDone.set(true);
    // Invalidate any in-flight bootstrap so the next bootstrap() starts fresh.
    this.bootstrap$ = null;
    if (hadSession) {
      this.sessionEvents.notifySessionEnded();
    }
  }

  /**
   * Signs out on the server, and only then drops the local session.
   *
   * - A 403 almost always means the boot-time CSRF cookie never arrived (the
   *   fetch is fire-and-forget): refetch it and retry the logout ONCE.
   * - A 401 means the session is already dead server-side — same end state.
   * - Anything else errors out WITHOUT touching local state: the HttpOnly cookie
   *   is still valid, so the UI must keep showing the user as signed in.
   */
  logout(): Observable<void> {
    return this.authApi.logout().pipe(
      catchError((err: unknown) =>
        statusOf(err) === 403
          ? this.authApi.fetchCsrfToken().pipe(switchMap(() => this.authApi.logout()))
          : throwError(() => err),
      ),
      catchError((err: unknown) => (statusOf(err) === 401 ? of(void 0) : throwError(() => err))),
      tap(() => this.clear()),
    );
  }

  /** Promise flavour of {@link logout} for async callers. */
  logoutAndWait(): Promise<void> {
    return firstValueFrom(this.logout(), { defaultValue: undefined });
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

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}
