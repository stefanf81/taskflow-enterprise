import { Service, signal } from '@angular/core';

/** Stable storage keys shared by the auth flow. */
const TOKEN_KEY = 'auth_token';
const ROLE_KEY = 'auth_role';

/**
 * Dedicated authentication store. Owns the client-side session state
 * (token, role, logged-in flag) that was previously entangled with
 * AppointmentStore. Feature stores (appointments, customers, ...) must
 * inject this for auth state instead of reaching into each other.
 */
@Service()
export class AuthStore {
  readonly isLoggedIn = signal<boolean>(!!sessionStorage.getItem(TOKEN_KEY));

  readonly role = signal<string | null>(sessionStorage.getItem(ROLE_KEY));

  /** Persist the auth response and flip the logged-in flag. */
  setSession(token: string, role: string): void {
    const tokenValue = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
    sessionStorage.setItem(TOKEN_KEY, tokenValue);
    sessionStorage.setItem(ROLE_KEY, role);
    this.role.set(role);
    this.isLoggedIn.set(true);
  }

  /** Clear the session and return to the guest state. */
  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    this.role.set(null);
    this.isLoggedIn.set(false);
  }

  /** Test/utility helper used by the interceptor side-effects. */
  clearToken(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    this.isLoggedIn.set(false);
  }
}
