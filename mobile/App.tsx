import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { queryClient } from './src/query/queryClient';
import { appTelemetry, installGlobalErrorReporting } from './src/core/telemetry/appTelemetry';
import { startApp } from './src/core/startup';

// A no-op unless EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE enables telemetry for this session.
installGlobalErrorReporting();
// The session restore and the shop info, before React renders anything (core/startup.ts).
startApp();

const reportRenderError = () => appTelemetry.reportError('RENDER_ERROR', 'OTHER');

export default function App() {
  return (
    <ErrorBoundary onError={reportRenderError}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <RootNavigator />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
