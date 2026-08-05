import { QueryClient } from '@tanstack/react-query';

// One cache instance is shared by the app and auth lifecycle. Clearing it on
// logout/expiry prevents one user's cached data appearing for the next user.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
