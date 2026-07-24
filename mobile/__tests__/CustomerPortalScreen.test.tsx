import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CustomerPortalScreen } from '../src/screens/CustomerPortalScreen';

jest.mock('../src/hooks/useCustomer', () => ({
  useCustomerAppointments: () => ({
    data: {
      content: [
        {
          id: 1, publicId: 'TF-0001', customerName: 'John', customerEmail: 'j@ex.com',
          customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-01',
          bookingTime: '10:00', serviceType: 'Haircut', status: 'PENDING' as const,
          createdAt: '', updatedAt: '',
        },
      ],
      totalPages: 1,
    },
    isLoading: false,
    refetch: jest.fn(),
  }),
  useCancelCustomerAppointment: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

const mockLogout = jest.fn();
jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: () => ({
    username: 'John',
    logout: mockLogout,
  }),
}));

describe('CustomerPortalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders welcome greeting', async () => {
    const { getByText } = await render(<CustomerPortalScreen />);
    expect(getByText('Welcome Back')).toBeTruthy();
    expect(getByText('John')).toBeTruthy();
  });

  it('renders appointments list', async () => {
    const { getByText } = await render(<CustomerPortalScreen />);
    expect(getByText('TF-0001')).toBeTruthy();
    expect(getByText('Haircut')).toBeTruthy();
  });

  it('renders section title', async () => {
    const { getByText } = await render(<CustomerPortalScreen />);
    expect(getByText('My Bookings')).toBeTruthy();
  });

  it('renders sign out button', async () => {
    const { getByText } = await render(<CustomerPortalScreen />);
    expect(getByText('Sign Out')).toBeTruthy();
  });

  it('calls logout when sign out pressed', async () => {
    const { getByText } = await render(<CustomerPortalScreen />);
    fireEvent.press(getByText('Sign Out'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('renders cancel button for pending appointments', async () => {
    const { getByText } = await render(<CustomerPortalScreen />);
    expect(getByText('Cancel Booking')).toBeTruthy();
  });
});
