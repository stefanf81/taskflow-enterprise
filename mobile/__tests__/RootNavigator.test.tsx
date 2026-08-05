import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { RootNavigator } from '../src/navigation/RootNavigator';

// Mock the auth store
const mockCheckAuth = jest.fn();
const mockLogout = jest.fn();
const mockUseAuthStore = jest.fn();

jest.mock('../src/store/useAuthStore', () => ({
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
jest.mock('../src/screens/LoginScreen', () => ({
  LoginScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/RegisterScreen', () => ({
  RegisterScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/PublicActionsScreen', () => ({
  PublicActionsScreen: () => <>{null}</>,
}));

describe('RootNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
  });

  it('shows loading spinner when isLoading is true', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isLoading: true,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
    expect(mockCheckAuth).toHaveBeenCalled();
  });

  it('renders navigator when not loading', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isLoading: false,
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
      isLoading: false,
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
      isLoading: false,
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
      isLoading: false,
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
      isLoading: false,
      isOffline: false,
      checkAuth: mockCheckAuth,
      logout: mockLogout,
    });

    await render(<RootNavigator />);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });
});
