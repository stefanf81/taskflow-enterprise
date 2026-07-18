import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
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

  /** Restore the role from the server using the session cookie. Safe to call repeatedly. */
  bootstrap(): void {
    this.appointmentService.me().subscribe({
      next: (me: LoginResponse) => {
        this.applyRole(me.role);
        this.bootstrapDone.set(true);
      },
      error: () => {
        this.clear();
        this.bootstrapDone.set(true);
      },
    });
  }

  applyRole(role: string): void {
    this.role.set(role);
    this.isLoggedIn.set(true);
  }

  clear(): void {
    this.role.set('');
    this.isLoggedIn.set(false);
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
