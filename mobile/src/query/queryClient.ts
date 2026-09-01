import { QueryClient } from '@tanstack/react-query';

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
