import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { ApiContractError } from '../api/contracts';
import { getHttpStatus, getRetryAfterSeconds } from '../utils/errors';
import { SessionExpiredError } from '../utils/session';

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

const MAX_QUERY_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 30_000;
// A longer server-requested wait is surfaced as an error instead ("try again in N s").
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Retry a failed query at most once, and only when another attempt can succeed:
 * a network failure or timeout, 408, or a 5xx. Another 4xx would be the same answer,
 * a broken contract stays broken, and an expired session must not be ended twice.
 * A 429 is retried only when the server sent a short `Retry-After` (waited out by
 * queryRetryDelay); any status with a longer `Retry-After` is not retried.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (error instanceof ApiContractError || error instanceof SessionExpiredError) return false;
  const status = getHttpStatus(error);
  if (status === undefined || status === 408) return true;
  const retryAfter = getRetryAfterSeconds(error);
  if (retryAfter !== null && retryAfter * 1000 > MAX_RETRY_AFTER_MS) return false;
  if (status === 429) return retryAfter !== null;
  return status >= 500;
}

/** Exponential backoff, or the server's `Retry-After` when it sent one (both capped). */
export function queryRetryDelay(attemptIndex: number, error: unknown): number {
  const retryAfter = getRetryAfterSeconds(error);
  if (retryAfter !== null) return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  return Math.min(1000 * 2 ** attemptIndex, MAX_RETRY_DELAY_MS);
}

// One cache instance is shared by the app and auth lifecycle. Clearing it on
// logout/expiry prevents one user's cached data appearing for the next user.
//
// networkMode 'always' keeps the fetch behaviour the app had while TanStack
// assumed it was always online: an offline request fails fast and the screens
// show their error + retry state. The default ('online') would instead leave
// queries pending without an error and hold mutations until the network
// returns, sending a booking or cancellation minutes after the user tapped it.
// With 'always', TanStack turns refetchOnReconnect off unless it is set.
//
// refetchOnWindowFocus (app foreground, see focusManager above) stays off by
// default: reference data does not change while the app is in the background.
// The hooks for volatile data (appointments, busy slots, notifications) opt in.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      refetchOnReconnect: true,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      networkMode: 'always',
    },
  },
});
