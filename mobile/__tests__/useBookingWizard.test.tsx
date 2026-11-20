import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: undefined }),
  useNavigation: () => ({ navigate: jest.fn(), dispatch: jest.fn(), addListener: () => () => undefined }),
}));

import { useBookingWizard } from '../src/features/booking/useBookingWizard';
import { useAuthStore } from '../src/core/auth/useAuthStore';
import { queryClient } from '../src/query/queryClient';

describe('useBookingWizard contact form', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      isBootstrapping: false,
      username: 'jane@example.com',
      role: 'ROLE_CUSTOMER',
    });
  });

  // In this order: a store change while the hook is still mounted creates queries, and their
  // five-minute garbage-collection timers would keep Jest from exiting.
  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, username: null, role: null });
    queryClient.clear();
  });

  it('renders once per keystroke for a signed-in customer', async () => {
    // The effect that merges the account's details depended on the edited fields, so editing
    // re-ran it: a second render per keystroke, then per field (BENCHMARKS.md §79).
    let renders = 0;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = await renderHook(
      () => {
        renders++;
        return useBookingWizard();
      },
      { wrapper },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50)); // catalog, barbers, shop info
    });
    expect(result.current.contact.email).toBe('jane@example.com');

    const perKeystroke: number[] = [];
    for (const value of ['J', 'Ja', 'Jan', 'Jane']) {
      const before = renders;
      await act(async () => result.current.setContactField('name', value));
      perKeystroke.push(renders - before);
    }

    expect(perKeystroke).toEqual([1, 1, 1, 1]);
    expect(result.current.contact).toEqual(
      expect.objectContaining({ name: 'Jane', email: 'jane@example.com' }),
    );
    await unmount();
  });
});
