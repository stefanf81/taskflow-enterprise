import React from 'react';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockLoginFn = jest.fn();
const mockClearErrorFn = jest.fn();

jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: () => ({
    login: mockLoginFn,
    clearError: mockClearErrorFn,
    error: null,
  }),
}));

import { LoginScreen } from '../src/screens/LoginScreen';

describe('LoginScreen', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('renders login form', async () => {
    await render(<LoginScreen />);
    expect(screen.getByText('Sign In to TaskFlow')).toBeTruthy();
    expect(screen.getByPlaceholderText('admin or customer@example.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••')).toBeTruthy();
  });

  it('calls login when form is submitted', async () => {
    mockLoginFn.mockResolvedValueOnce({ username: 'admin', role: 'ROLE_ADMIN' });
    await render(<LoginScreen />);

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('admin or customer@example.com'), 'admin');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'admin-password');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Sign In'));
    });

    expect(mockLoginFn).toHaveBeenCalledWith({ username: 'admin', password: 'admin-password' });
  });

  it('does not call login when fields are empty', async () => {
    await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Sign In'));
    });
    expect(mockLoginFn).not.toHaveBeenCalled();
  });

  it('navigates to Register when register link is pressed', async () => {
    await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Register here'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('Register');
  });
});
