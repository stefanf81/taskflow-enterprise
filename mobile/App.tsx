import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { authApi } from './src/api/auth';
import { setCsrfToken } from './src/api/client';

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    // Pre-fetch CSRF token on startup so first state-changing request
    // doesn't incur the one-time lazy-fetch latency.
    authApi.fetchCsrfToken().then(setCsrfToken).catch(() => {
      // CSRF unavailable — the interceptor will lazily fetch it.
    });
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <RootNavigator />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
