import React from 'react';
import { render } from '@testing-library/react-native';
import { RootNavigator } from '../src/navigation/RootNavigator';

// Mock the auth store
const mockCheckAuth = jest.fn();
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
  });

  it('shows loading spinner when isLoading is true', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isLoading: true,
      checkAuth: mockCheckAuth,
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
      checkAuth: mockCheckAuth,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
  });

  it('renders navigator for authenticated admin', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: true,
      role: 'ROLE_ADMIN',
      isLoading: false,
      checkAuth: mockCheckAuth,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
  });

  it('renders navigator for authenticated customer', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: true,
      role: 'ROLE_CUSTOMER',
      isLoading: false,
      checkAuth: mockCheckAuth,
    });

    const { container } = await render(<RootNavigator />);
    expect(container).toBeTruthy();
  });

  it('calls checkAuth on mount', async () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: false,
      role: null,
      isLoading: false,
      checkAuth: mockCheckAuth,
    });

    await render(<RootNavigator />);
    expect(mockCheckAuth).toHaveBeenCalledTimes(1);
  });
});
