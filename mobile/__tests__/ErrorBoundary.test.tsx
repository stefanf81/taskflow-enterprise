import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import { ErrorBoundary } from '../src/components/common/ErrorBoundary';

// Suppress console.error from React error boundary logging
jest.spyOn(console, 'error').mockImplementation(() => {});

const Thrower: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <Text>All good</Text>;
};

describe('ErrorBoundary Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders children when no error occurs', async () => {
    await render(
      <ErrorBoundary>
        <Text>All good</Text>
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('renders error UI when a child throws', async () => {
    await render(
      <ErrorBoundary>
        <Thrower shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('An unexpected error occurred. Please restart the app.')).toBeTruthy();
  });

  it('logs error to console in componentDidCatch', async () => {
    const consoleSpy = jest.spyOn(console, 'error');
    await render(
      <ErrorBoundary>
        <Thrower shouldThrow />
      </ErrorBoundary>
    );
    expect(consoleSpy).toHaveBeenCalled();
  });
});
