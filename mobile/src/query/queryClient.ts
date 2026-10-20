import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';

// TanStack Query has no notion of React Native's app lifecycle by default:
// without this, `refetchInterval` keeps polling while the app is backgrounded.
// Mirror AppState into focusManager so interval refetches pause when the app
// is not active (refetchIntervalInBackground defaults to false) and resume on
// return.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (status) => {
    handleFocus(status === 'active');
  });
  return () => subscription.remove();
});

// React Native has no `online`/`offline` window events, so TanStack considered
// the app online forever and `refetchOnReconnect` never fired. Feed it the
// device's connectivity (TanStack's React Native guide, expo-network variant):
// coming back online now refetches the stale and failed queries on screen. An
// unknown state (`isConnected` undefined) counts as online.
onlineManager.setEventListener((setOnline) => {
  let initialised = false;
  const subscription = Network.addNetworkStateListener((state) => {
    initialised = true;
    setOnline(state.isConnected !== false);
  });
  Network.getNetworkStateAsync()
    .then((state) => {
      if (!initialised) {
        setOnline(state?.isConnected !== false);
      }
    })
    .catch(() => undefined);
  return () => subscription.remove();
});

// One cache instance is shared by the app and auth lifecycle. Clearing it on
// logout/expiry prevents one user's cached data appearing for the next user.
//
// networkMode 'always' keeps the fetch behaviour the app had while TanStack
// assumed it was always online: an offline request fails fast and the screens
// show their error + retry state. The default ('online') would instead leave
// queries pending without an error and hold mutations until the network
// returns, sending a booking or cancellation minutes after the user tapped it.
// With 'always', TanStack turns refetchOnReconnect off unless it is set.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      networkMode: 'always',
    },
  },
});
