import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../test/mocks/server';

jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    __memory: memory,
    setItemAsync: async (key: string, value: string) => {
      memory.set(key, value);
    },
    getItemAsync: async (key: string) => memory.get(key) ?? null,
    deleteItemAsync: async (key: string) => {
      memory.delete(key);
    },
  };
});
jest.mock('../src/navigation/CustomerTabNavigator', () => {
  const { Text } = require('react-native');
  return { CustomerTabNavigator: () => <Text>CUSTOMER AREA</Text> };
});

import { startApp } from '../src/core/startup';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { queryClient } from '../src/query/queryClient';
import { useAuthStore } from '../src/core/auth/useAuthStore';

const secureMemory: Map<string, string> = require('expo-secure-store').__memory;

describe('startApp', () => {
  const realCheckAuth = useAuthStore.getState().checkAuth;
  afterEach(() => {
    useAuthStore.setState({ checkAuth: realCheckAuth });
    queryClient.clear();
  });

  it('loads the shop info while the session is restored, and RootNavigator does not restore again', async () => {
    // The shop info used to be requested only once the first screen had mounted after the
    // restore: one round trip later (BENCHMARKS.md §80).
    secureMemory.set('taskflow_auth_token', 'stored-jwt');
    secureMemory.set('taskflow_token_expires_at', String(Date.now() + 3_600_000));
    const events: string[] = [];
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        events.push('me');
        await delay(100);
        events.push('me answered');
        return HttpResponse.json({ username: 'jane@example.com', role: 'ROLE_CUSTOMER' });
      }),
      http.get('*/api/v1/appointments/public/shop', () => {
        events.push('shop');
        return HttpResponse.json({ timeZone: 'Europe/Berlin', maxAdvanceDays: 90, openingHours: [] });
      }),
    );

    // Counts restores: a second one would supersede the first and read the Keychain again.
    const checkAuth = jest.fn(() => realCheckAuth());
    useAuthStore.setState({ checkAuth });

    startApp();
    await render(<RootNavigator />);
    await screen.findByText('CUSTOMER AREA');

    expect(checkAuth).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event === 'me')).toHaveLength(1);
    expect(events.indexOf('shop')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('shop')).toBeLessThan(events.indexOf('me answered'));
    expect(queryClient.getQueryData(['shopInfo'])).toEqual(
      expect.objectContaining({ timeZone: 'Europe/Berlin' }),
    );
  });
});
