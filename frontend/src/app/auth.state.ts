import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap, shareReplay } from 'rxjs';
import { AppointmentService, LoginResponse } from './appointment.service';

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
  private readonly appointmentService = inject(AppointmentService);
  private readonly router = inject(Router);

  readonly role = signal<string>('');
  readonly isLoggedIn = signal<boolean>(false);
  private bootstrapDone = signal<boolean>(false);

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
      this.bootstrap$ = this.appointmentService.me().pipe(
        map((me: LoginResponse) => me.role),
        tap({
          next: (role) => {
            this.applyRole(role);
            this.bootstrapDone.set(true);
            this.bootstrap$ = null;
          },
          error: () => {
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
