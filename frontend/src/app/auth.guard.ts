import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthState } from './auth.state';

/**
 * C2 — client-side route guard.
 *
 * Protects the admin and customer dashboards from being opened while logged out.
 * The guard reads the in-memory `AuthState` role (never `sessionStorage`). If the
 * role hasn't been restored yet (e.g. a hard refresh or a direct deep-link), it
 * triggers `AuthState.bootstrap()` which re-derives the role from the server's
 * HttpOnly session cookie via `me()`.
 *
 * Both paths share one decision: a role that matches the requested section gets
 * the requested URL exactly as asked (query string and fragment included); only
 * a mismatch is redirected to the role's own dashboard.
 *
 * Note: this is a UX guard only. Every protected data endpoint is independently
 * gated on the server by `SecurityConfig` role checks, so a bypassed guard cannot
 * reach any real data.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthState);
  const router = inject(Router);

  /** `true` when `role` may see `state.url`, otherwise where it should go instead. */
  const decide = (role: string): boolean | UrlTree => {
    if (role !== 'ROLE_ADMIN' && role !== 'ROLE_CUSTOMER') {
      return router.createUrlTree(['']);
    }
    const section = router.parseUrl(state.url).root.children['primary']?.segments[0]?.path;
    // Enforce role→section: an admin deep-linking to /customer is sent to /admin.
    if (role === 'ROLE_ADMIN' && section === 'customer') {
      return router.createUrlTree(['/admin']);
    }
    if (role === 'ROLE_CUSTOMER' && section === 'admin') {
      return router.createUrlTree(['/customer']);
    }
    return true;
  };

  const role = auth.role();
  if (role) {
    return decide(role);
  }

  // No role in memory yet — try to restore from the server once.
  if (!auth.isBootstrapDone()) {
    return auth.bootstrap().pipe(
      map((resolvedRole) => decide(resolvedRole)),
      catchError(() => of(router.createUrlTree(['']))),
    );
  }

  return router.createUrlTree(['']);
};
