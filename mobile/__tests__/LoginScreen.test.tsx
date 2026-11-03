import React from 'react';
import {
  render,
  fireEvent,
  screen,
  cleanup,
  act,
} from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockLoginFn = jest.fn();
const mockClearErrorFn = jest.fn();
// The store's shared error, e.g. left behind by a failed registration.
let mockStoreError: string | null = null;

jest.mock('../src/core/auth/useAuthStore', () => ({
  useAuthStore: () => ({
    login: mockLoginFn,
    clearError: mockClearErrorFn,
    error: mockStoreError,
  }),
}));

import { LoginScreen } from '../src/features/auth/LoginScreen';

describe('LoginScreen', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    mockStoreError = null;
  });

  it('renders login form', async () => {
    await render(<LoginScreen />);
    expect(screen.getByText('Sign In to TaskFlow')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('admin or customer@example.com'),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••')).toBeTruthy();
  });

  it('calls login when form is submitted', async () => {
    mockLoginFn.mockResolvedValueOnce({
      username: 'admin',
      role: 'ROLE_ADMIN',
    });
    await render(<LoginScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('admin or customer@example.com'),
        'admin',
      );
    });
    await act(async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('••••••••'),
        'admin-password',
      );
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Sign In'));
    });

    expect(mockLoginFn).toHaveBeenCalledWith({
      username: 'admin',
      password: 'admin-password',
    });
  });

  it('shows field errors when fields are empty', async () => {
    await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Sign In'));
    });
    expect(mockLoginFn).not.toHaveBeenCalled();
    expect(screen.getByText('Username is required')).toBeTruthy();
    expect(screen.getByText('Password is required')).toBeTruthy();
  });

  it('shows its own login failure, never an error another auth screen left in the store', async () => {
    mockStoreError = 'Email already registered';
    mockLoginFn.mockRejectedValueOnce(new Error('Invalid username or password'));
    await render(<LoginScreen />);
    expect(screen.queryByText('Email already registered')).toBeNull();

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('admin or customer@example.com'), 'admin');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'wrong');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Sign In'));
    });

    expect(screen.getByText('Invalid username or password')).toBeTruthy();
    expect(screen.queryByText('Email already registered')).toBeNull();
  });

  it('navigates to Register when register link is pressed', async () => {
    await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Register here'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('Register');
  });
});
