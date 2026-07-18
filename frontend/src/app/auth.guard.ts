import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
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
 * Note: this is a UX guard only. Every protected data endpoint is independently
 * gated on the server by `SecurityConfig` role checks, so a bypassed guard cannot
 * reach any real data.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthState);
  const router = inject(Router);

  const role = auth.role();
  if (role === 'ROLE_ADMIN' || role === 'ROLE_CUSTOMER') {
    // Enforce role→section: an admin deep-linking to /customer is sent to /admin.
    const target = state.url.startsWith('/admin') ? '/admin' : '/customer';
    if (role === 'ROLE_ADMIN' && state.url.startsWith('/customer')) {
      return router.createUrlTree(['/admin']);
    }
    if (role === 'ROLE_CUSTOMER' && state.url.startsWith('/admin')) {
      return router.createUrlTree(['/customer']);
    }
    return true;
  }

  // No role in memory yet — try to restore from the server once.
  if (!auth.isBootstrapDone()) {
    auth.bootstrap();
    // bootstrap is async; redirect to login and let ngOnInit land the user correctly.
    return router.createUrlTree(['/login'], {
      queryParams: { redirect: state.url },
    });
  }

  return router.createUrlTree(['/login'], {
    queryParams: { redirect: state.url },
  });
};
