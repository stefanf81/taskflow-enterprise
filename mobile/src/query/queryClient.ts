import { AppState } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';

// TanStack Query has no notion of React Native's app lifecycle by default:
// without this, `refetchInterval` keeps polling while the app is backgrounded.
// Mirror AppState into focusManager so interval refetches pause when the app
// is not active (refetchIntervalInBackground defaults to false) and resume on
// return. The listener is installed lazily by TanStack when the first query
// subscribes and removed when the last one unsubscribes.
//
// onlineManager is intentionally not wired: it needs
// @react-native-community/netinfo, which is not a dependency of this app.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (status) => {
    handleFocus(status === 'active');
  });
  return () => subscription.remove();
});

// One cache instance is shared by the app and auth lifecycle. Clearing it on
// logout/expiry prevents one user's cached data appearing for the next user.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    },
  },
});
