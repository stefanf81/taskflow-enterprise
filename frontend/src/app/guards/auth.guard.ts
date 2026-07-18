import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthStore } from '../auth.store';

/**
 * Route guard (canMatch) that only allows access to authenticated users.
 * Unauthenticated visitors are redirected to the login page. Using canMatch
 * means the protected lazy bundle is never even downloaded for guests.
 */
export const authGuard: CanMatchFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return auth.isLoggedIn() ? true : router.createUrlTree(['/login']);
};
