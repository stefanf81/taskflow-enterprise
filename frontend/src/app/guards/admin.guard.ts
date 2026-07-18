import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthStore } from '../auth.store';

/**
 * Route guard (canMatch) that only allows access to admin (ROLE_ADMIN)
 * users. Non-admins are sent back to the public home page. Using canMatch
 * keeps the admin feature bundle out of the initial download for everyone
 * who is not an authenticated admin.
 */
export const adminGuard: CanMatchFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (auth.isLoggedIn() && auth.role() === 'ROLE_ADMIN') {
    return true;
  }
  return router.createUrlTree(['/']);
};
