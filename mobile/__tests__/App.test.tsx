import React from 'react';
import { render } from '@testing-library/react-native';

const mockFetchCsrfToken = jest.fn();

jest.mock('../src/api/auth', () => ({
  authApi: {
    fetchCsrfToken: () => mockFetchCsrfToken(),
  },
}));

jest.mock('../src/api/client', () => ({
  setCsrfToken: jest.fn(),
}));

jest.mock('../src/navigation/RootNavigator', () => ({
  RootNavigator: () => <>{null}</>,
}));

jest.mock('../src/components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import App from '../App';

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', async () => {
    mockFetchCsrfToken.mockResolvedValueOnce('csrf-token');
    const { container } = await render(<App />);
    expect(container).toBeTruthy();
  });

  it('fetches CSRF token on mount', async () => {
    mockFetchCsrfToken.mockResolvedValueOnce('csrf-token');
    await render(<App />);
    expect(mockFetchCsrfToken).toHaveBeenCalledTimes(1);
  });

  it('handles CSRF fetch failure gracefully', async () => {
    mockFetchCsrfToken.mockRejectedValueOnce(new Error('Network error'));
    const { container } = await render(<App />);
    expect(container).toBeTruthy();
  });
});
