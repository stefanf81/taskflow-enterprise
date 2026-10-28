import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { RootNavigator } from '../src/navigation/RootNavigator';

// Mock the auth store
const mockCheckAuth = jest.fn();
const mockLogout = jest.fn();
const mockResetSavedSession = jest.fn();
const mockUseAuthStore = jest.fn();
const mockUseFonts = jest.fn();

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: (...args: unknown[]) => mockUseFonts(...args),
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/core/auth/useAuthStore', () => ({
  useAuthStore: () => mockUseAuthStore(),
}));

// Mock all child navigators/screens
jest.mock('../src/navigation/GuestTabNavigator', () => ({
  GuestTabNavigator: () => <>{null}</>,
}));
jest.mock('../src/navigation/CustomerTabNavigator', () => ({
  CustomerTabNavigator: () => <>{null}</>,
}));
jest.mock('../src/navigation/AdminTabNavigator', () => ({
  AdminTabNavigator: () => <>{null}</>,
}));
jest.mock('../src/features/auth/LoginScreen', () => ({
  LoginScreen: () => <>{null}</>,
}));
jest.mock('../src/features/auth/RegisterScreen', () => ({
  RegisterScreen: () => <>{null}</>,
}));
jest.mock('../src/features/landing/PublicActionsScreen', () => ({
  PublicActionsScreen: () => <>{null}</>,
}));

describe('RootNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
    mockUseFonts.mockReturnValue([true, null]);
  });

  describe('native splash', () => {
    const restoredGuest = {
      isAuthenticated: false,
      role: null,
      isBootstrapping: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    };

    it('stays up while the icon font is still loading', async () => {
      mockUseAuthStore.mockReturnValue(restoredGuest);
      mockUseFonts.mockReturnValue([false, null]);

      await render(<RootNavigator />);

      expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    });

    it('stays up while the session is still being restored', async () => {
      mockUseAuthStore.mockReturnValue({ ...restoredGuest, isBootstrapping: true });

      await render(<RootNavigator />);

      expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    });

    it('hides once the session is restored and the icon font is loaded', async () => {
      mockUseAuthStore.mockReturnValue(restoredGuest);

      await render(<RootNavigator />);

      expect(mockUseFonts).toHaveBeenCalledWith(
        expect.objectContaining({ ionicons: expect.anything() }),
      );
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    it('does not wait forever when the icon font fails to load', async () => {
      mockUseAuthStore.mockReturnValue(restoredGuest);
      mockUseFonts.mockReturnValue([false, new Error('font missing')]);

      await render(<RootNavigator />);

      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the splash while bootstrapping', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isBootstrapping: true,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
    expect(mockCheckAuth).toHaveBeenCalled();
  });

  it('renders navigator when not bootstrapping', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isBootstrapping: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
  });

  it('renders navigator for authenticated admin', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: true,
      role: 'ROLE_ADMIN',
      isBootstrapping: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
  });

  it('renders navigator for authenticated customer', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: true,
      role: 'ROLE_CUSTOMER',
      isBootstrapping: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
  });

  it('calls checkAuth on mount', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isBootstrapping: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    await render(<RootNavigator />);
    expect(mockCheckAuth).toHaveBeenCalledTimes(1);
  });

  it('fails closed and signs out an authenticated unknown role', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: true,
      role: 'ROLE_UNKNOWN',
      isBootstrapping: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    await render(<RootNavigator />);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  describe('offline screen', () => {
    const base = {
      isAuthenticated: false,
      role: null,
      isBootstrapping: false,
      isOffline: true,
      checkAuth: mockCheckAuth,
      resetSavedSession: mockResetSavedSession,
      logout: mockLogout,
    };

    it('only offers a retry when the server is unreachable', async () => {
      mockUseAuthStore.mockReturnValue({ ...base, storageUnavailable: false });

      const { getByText, queryByText } = await render(<RootNavigator />);

      expect(getByText('Could not reach TaskFlow.')).toBeTruthy();
      expect(queryByText('Continue as guest')).toBeNull();
    });

    it('offers to drop the saved sign-in when secure storage cannot be read', async () => {
      mockUseAuthStore.mockReturnValue({ ...base, storageUnavailable: true });

      const { getByText } = await render(<RootNavigator />);

      expect(getByText('Could not open your saved sign-in.')).toBeTruthy();
      await fireEvent.press(getByText('Continue as guest'));
      expect(mockResetSavedSession).toHaveBeenCalledTimes(1);
    });
  });
});
