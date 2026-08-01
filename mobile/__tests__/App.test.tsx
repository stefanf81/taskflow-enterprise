import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../src/navigation/RootNavigator', () => ({
  RootNavigator: () => <>{null}</>,
}));

jest.mock('../src/components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import App from '../App';

describe('App', () => {
  it('renders without performing cookie or CSRF bootstrap work', async () => {
    const { container } = await render(<App />);
    expect(container).toBeTruthy();
  });
});
