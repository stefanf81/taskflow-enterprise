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

const mockRegisterFn = jest.fn();
const mockClearErrorFn = jest.fn();
// The store's shared error, e.g. left behind by a failed login.
let mockStoreError: string | null = null;

jest.mock('../src/core/auth/useAuthStore', () => ({
  useAuthStore: () => ({
    register: mockRegisterFn,
    clearError: mockClearErrorFn,
    error: mockStoreError,
  }),
}));

import { RegisterScreen } from '../src/features/auth/RegisterScreen';

describe('RegisterScreen', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    mockStoreError = null;
  });

  it('does not greet the visitor with a failed login from the previous screen', async () => {
    mockStoreError = 'Invalid username or password';
    await render(<RegisterScreen />);
    expect(screen.queryByText('Invalid username or password')).toBeNull();
  });

  it('shows its own registration failure', async () => {
    mockRegisterFn.mockRejectedValueOnce(new Error('Email already registered'));
    await render(<RegisterScreen />);
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('e.g. Jane Smith'), 'Jane Smith');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('jane.smith@example.com'), 'jane@example.com');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('+1 (555) 000-0000'), '+1-555-0000');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'password123');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Create Account'));
    });
    expect(screen.getByText('Email already registered')).toBeTruthy();
  });

  it('renders registration form', async () => {
    await render(<RegisterScreen />);
    expect(screen.getByText('Create Customer Account')).toBeTruthy();
    expect(screen.getByText('Create Account')).toBeTruthy();
  });

  it('renders sign-in link', async () => {
    await render(<RegisterScreen />);
    expect(screen.getByText('Sign in here')).toBeTruthy();
  });

  it('calls register when form is submitted with all fields', async () => {
    mockRegisterFn.mockResolvedValueOnce(undefined);
    await render(<RegisterScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('e.g. Jane Smith'),
        'Jane Smith',
      );
    });
    await act(async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('jane.smith@example.com'),
        'jane@example.com',
      );
    });
    await act(async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('+1 (555) 000-0000'),
        '+1-555-0000',
      );
    });
    await act(async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('••••••••'),
        'password123',
      );
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Create Account'));
    });

    expect(mockRegisterFn).toHaveBeenCalledWith({
      fullName: 'Jane Smith',
      email: 'jane@example.com',
      password: 'password123',
      phone: '+1-555-0000',
    });
  });

  it('shows field errors when required fields are empty', async () => {
    await render(<RegisterScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Create Account'));
    });
    expect(mockRegisterFn).not.toHaveBeenCalled();
    expect(screen.getByText('Full name is required')).toBeTruthy();
    expect(screen.getByText('Email is required')).toBeTruthy();
    expect(screen.getByText('Phone number is required')).toBeTruthy();
    expect(
      screen.getByText('Password must be at least 8 characters'),
    ).toBeTruthy();
  });
});
