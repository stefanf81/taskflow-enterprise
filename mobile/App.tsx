import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { queryClient } from './src/query/queryClient';

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <RootNavigator />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
