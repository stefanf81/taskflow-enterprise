/**
 * MOB-1 regression: these tests deliberately use the REAL auth store, the REAL
 * RootNavigator/NavigationContainer and the REAL Login/Register screens (only the
 * network, via MSW, and the secure storage are faked). The older RootNavigator and
 * LoginScreen tests mock the store, which hid the bug where login/register flipped
 * a global `isLoading`, RootNavigator replaced the NavigationContainer with a
 * splash, and a failed attempt landed on Home with its error message lost.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
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

// Replace only the heavy tab navigators; Login/Register and the Root stack are real.
jest.mock('../src/navigation/GuestTabNavigator', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  const { useNavigation } = require('@react-navigation/native');
  return {
    GuestTabNavigator: () => {
      const navigation = useNavigation();
      return (
        <View>
          <Text>GUEST HOME</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text>open-login</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Register')}>
            <Text>open-register</Text>
          </TouchableOpacity>
        </View>
      );
    },
  };
});
jest.mock('../src/navigation/CustomerTabNavigator', () => {
  const { Text } = require('react-native');
  return { CustomerTabNavigator: () => <Text>CUSTOMER AREA</Text> };
});
jest.mock('../src/navigation/AdminTabNavigator', () => {
  const { Text } = require('react-native');
  return { AdminTabNavigator: () => <Text>ADMIN AREA</Text> };
});
jest.mock('../src/screens/PublicActionsScreen', () => {
  const { Text } = require('react-native');
  return { PublicActionsScreen: () => <Text>PUBLIC ACTIONS</Text> };
});

import { RootNavigator } from '../src/navigation/RootNavigator';
import { useAuthStore } from '../src/store/useAuthStore';
import { queryClient } from '../src/query/queryClient';
import { SESSION_EXPIRED_MESSAGE } from '../src/utils/session';

const secureMemory: Map<string, string> = require('expo-secure-store').__memory;

const resetStore = () =>
  useAuthStore.setState({
    isAuthenticated: false,
    isBootstrapping: true,
    username: null,
    role: null,
    isOffline: false,
    error: null,
    sessionNotice: null,
  });

async function openLogin() {
  await screen.findByText('GUEST HOME');
  await fireEvent.press(screen.getByText('open-login'));
  await screen.findByText('Sign In to TaskFlow');
}

async function submitLogin(username = 'admin', password = 'wrong-password') {
  await fireEvent.changeText(screen.getByTestId('login-email-input'), username);
  await fireEvent.changeText(screen.getByTestId('login-password-input'), password);
  await fireEvent.press(screen.getByTestId('login-submit-btn'));
}

describe('RootNavigator with the real auth store (MOB-1)', () => {
  beforeEach(() => {
    secureMemory.clear();
    queryClient.clear();
    resetStore();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('shows the splash only while the stored session is being restored', async () => {
    secureMemory.set('taskflow_auth_token', 'stored-jwt');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        await gate;
        return HttpResponse.json({ username: 'admin', role: 'ROLE_ADMIN' });
      }),
    );

    await render(<RootNavigator />);
    // /me is pending: neither guest nor admin UI is mounted yet.
    expect(screen.queryByText('GUEST HOME')).toBeNull();
    expect(screen.queryByText('ADMIN AREA')).toBeNull();
    expect(useAuthStore.getState().isBootstrapping).toBe(true);

    await act(async () => {
      release();
    });
    expect(await screen.findByText('ADMIN AREA')).toBeTruthy();
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('keeps the user on the sign-in screen and shows the server error after a failed login', async () => {
    server.use(
      http.post('*/api/v1/auth/mobile/login', () =>
        HttpResponse.json({ message: 'Invalid username or password' }, { status: 401 }),
      ),
    );
    await render(<RootNavigator />);
    await openLogin();

    await submitLogin();

    expect(await screen.findByText('Invalid username or password')).toBeTruthy();
    // Still on Login — the NavigationContainer was not replaced by a splash.
    expect(screen.getByText('Sign In to TaskFlow')).toBeTruthy();
    expect(screen.queryByText('GUEST HOME')).toBeNull();
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('keeps the typed credentials (the screen was never unmounted) after a failed login', async () => {
    server.use(
      http.post('*/api/v1/auth/mobile/login', () =>
        HttpResponse.json({ message: 'Invalid username or password' }, { status: 401 }),
      ),
    );
    await render(<RootNavigator />);
    await openLogin();
    await submitLogin('someone@example.com', 'wrong-password');
    await screen.findByText('Invalid username or password');

    expect(screen.getByDisplayValue('someone@example.com')).toBeTruthy();
  });

  it('shows "Too many attempts, try again in N s" for a throttled login (429)', async () => {
    server.use(
      http.post('*/api/v1/auth/mobile/login', () =>
        HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
      ),
    );
    await render(<RootNavigator />);
    await openLogin();
    await submitLogin();

    expect(await screen.findByText('Too many attempts, try again in 30 s')).toBeTruthy();
    expect(screen.getByText('Sign In to TaskFlow')).toBeTruthy();
  });

  it('routes to the admin area after a successful login and stores token + expiry', async () => {
    await render(<RootNavigator />);
    await openLogin();
    await submitLogin('admin', 'admin-password');

    expect(await screen.findByText('ADMIN AREA')).toBeTruthy();
    expect(secureMemory.get('taskflow_auth_token')).toBe('mobile-jwt');
    expect(Number(secureMemory.get('taskflow_token_expires_at'))).toBeGreaterThan(Date.now());
  });

  it('shows the registration success state', async () => {
    await render(<RootNavigator />);
    await screen.findByText('GUEST HOME');
    await fireEvent.press(screen.getByText('open-register'));
    await screen.findByText('Create Customer Account');

    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Jane Smith'), 'Jane Smith');
    await fireEvent.changeText(screen.getByPlaceholderText('jane.smith@example.com'), 'jane@example.com');
    await fireEvent.changeText(screen.getByPlaceholderText('+1 (555) 000-0000'), '+15550000000');
    await fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'password123');
    const createButtons = screen.getAllByText('Create Account');
    await fireEvent.press(createButtons[createButtons.length - 1]!);

    expect(await screen.findByText('Account Registered Successfully!')).toBeTruthy();
    expect(screen.queryByText('GUEST HOME')).toBeNull();
  });

  it('shows the server error after a failed registration without leaving the screen', async () => {
    server.use(
      http.post('*/api/v1/auth/register', () =>
        HttpResponse.json({ message: 'Email already registered' }, { status: 409 }),
      ),
    );
    await render(<RootNavigator />);
    await screen.findByText('GUEST HOME');
    await fireEvent.press(screen.getByText('open-register'));
    await screen.findByText('Create Customer Account');

    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Jane Smith'), 'Jane Smith');
    await fireEvent.changeText(screen.getByPlaceholderText('jane.smith@example.com'), 'jane@example.com');
    await fireEvent.changeText(screen.getByPlaceholderText('+1 (555) 000-0000'), '+15550000000');
    await fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'password123');
    const createButtons = screen.getAllByText('Create Account');
    await fireEvent.press(createButtons[createButtons.length - 1]!);

    expect(await screen.findByText('Email already registered')).toBeTruthy();
    expect(screen.getByText('Create Customer Account')).toBeTruthy();
    expect(screen.queryByText('GUEST HOME')).toBeNull();
  });
});

describe('session lifecycle in RootNavigator (MOB-8/9)', () => {
  beforeEach(() => {
    secureMemory.clear();
    queryClient.clear();
    resetStore();
  });

  it('signs out cleanly with a visible notice when the stored token already expired', async () => {
    secureMemory.set('taskflow_auth_token', 'expired-jwt');
    secureMemory.set('taskflow_token_expires_at', String(Date.now() - 60_000));
    let meCalled = false;
    server.use(
      http.get('*/api/v1/auth/me', () => {
        meCalled = true;
        return HttpResponse.json({ username: 'admin', role: 'ROLE_ADMIN' });
      }),
    );

    await render(<RootNavigator />);

    expect(await screen.findByText('GUEST HOME')).toBeTruthy();
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    expect(meCalled).toBe(false);
    expect(secureMemory.has('taskflow_auth_token')).toBe(false);

    await fireEvent.press(screen.getByLabelText('Dismiss notice'));
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).toBeNull();
  });

  it('logs out through the server, clears storage and returns to the guest area', async () => {
    let logoutAuthHeader: string | null = null;
    server.use(
      http.post('*/api/v1/auth/logout', ({ request }) => {
        logoutAuthHeader = request.headers.get('authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await render(<RootNavigator />);
    await screen.findByText('GUEST HOME');
    await fireEvent.press(screen.getByText('open-login'));
    await screen.findByText('Sign In to TaskFlow');
    await fireEvent.changeText(screen.getByTestId('login-email-input'), 'admin');
    await fireEvent.changeText(screen.getByTestId('login-password-input'), 'admin-password');
    await fireEvent.press(screen.getByTestId('login-submit-btn'));
    await screen.findByText('ADMIN AREA');

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(logoutAuthHeader).toBe('Bearer mobile-jwt');
    expect(await screen.findByText('GUEST HOME')).toBeTruthy();
    expect(secureMemory.size).toBe(0);
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
  });

  it('still signs out when the server is unreachable during logout', async () => {
    server.use(http.post('*/api/v1/auth/logout', () => HttpResponse.error()));
    await render(<RootNavigator />);
    await screen.findByText('GUEST HOME');
    await fireEvent.press(screen.getByText('open-login'));
    await screen.findByText('Sign In to TaskFlow');
    await fireEvent.changeText(screen.getByTestId('login-email-input'), 'admin');
    await fireEvent.changeText(screen.getByTestId('login-password-input'), 'admin-password');
    await fireEvent.press(screen.getByTestId('login-submit-btn'));
    await screen.findByText('ADMIN AREA');

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(await screen.findByText('GUEST HOME')).toBeTruthy();
    expect(secureMemory.size).toBe(0);
  });
});
