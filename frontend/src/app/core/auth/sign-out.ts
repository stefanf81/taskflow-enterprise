import { inject } from '@angular/core';
import { extractApiError } from '../api/extract-api-error';
import { FlashMessages } from '../ui/flash-messages';
import { AuthState } from './auth.state';

/** Banner copy when the server did not confirm a sign-out. */
export const SIGN_OUT_FAILED_MESSAGE =
  'Could not sign out. Please check your connection and try again.';

/**
 * Returns the dashboards' sign-out action; call it in an injection context.
 *
 * The session stays alive (and the user stays on the page) until the server confirms: a failed
 * logout leaves a still-valid HttpOnly cookie, so pretending to be signed out would be a lie.
 * The action resolves `true` once signed out, and `false` after putting the error on the shared
 * banner ({@link FlashMessages}) and keeping the session.
 */
export function injectSignOut(): () => Promise<boolean> {
  const authState = inject(AuthState);
  const flash = inject(FlashMessages);
  return async () => {
    try {
      await authState.logoutAndWait();
      return true;
    } catch (err) {
      flash.errorMessage.set(extractApiError(err, SIGN_OUT_FAILED_MESSAGE));
      return false;
    }
  };
}
