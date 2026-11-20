import { useAuthStore } from './auth/useAuthStore';
import { shopInfoQuery } from './shop/useShopInfo';
import { queryClient } from '../query/queryClient';

let startedEarly = false;

/**
 * Starts what every launch waits for, as soon as the bundle has loaded (App.tsx), and together:
 * restoring the saved session (the Keychain/Keystore, then `/me` or a renewal) and the shop's
 * hours and time zone, which every first screen shows. The restore used to start only after
 * React's first commit (RootNavigator's mount effect), and the shop info only once the first
 * screen had mounted after the splash, one round trip after the restore (BENCHMARKS.md §80).
 * The shop info is public: it is the same before and after the session is known.
 */
export function startApp(): void {
  if (startedEarly) return;
  startedEarly = true;
  void useAuthStore.getState().checkAuth();
  void queryClient.prefetchQuery(shopInfoQuery);
}

/**
 * Whether startApp() already started the session restore that RootNavigator would otherwise
 * start on mount. Answers true once: a later mount (a test, a remount) restores again.
 */
export function takeEarlyStart(): boolean {
  const started = startedEarly;
  startedEarly = false;
  return started;
}
