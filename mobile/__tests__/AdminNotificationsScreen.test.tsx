import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { AdminNotificationsScreen } from '../src/screens/AdminNotificationsScreen';

let mockIsError: boolean;
const mockRefetch = jest.fn();

jest.mock('../src/hooks/useNotifications', () => ({
  useNotifications: () => ({
    data: [
      { id: 1, recipient: 'admin@taskflow.com', type: 'APPOINTMENT_CONFIRMED', message: 'Appointment confirmed for John', sentAt: '2026-07-24T10:00:00', status: 'SENT' },
      { id: 2, recipient: 'customer@ex.com', type: 'CANCELLATION', message: 'Booking cancelled', sentAt: '2026-07-23T15:00:00', status: 'SENT' },
    ],
    isLoading: false,
    isError: mockIsError,
    refetch: mockRefetch,
  }),
}));

describe('AdminNotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsError = false;
  });

  it('renders notification outbox title', async () => {
    const { getByText } = await render(<AdminNotificationsScreen />);
    expect(getByText('Email Audit Log')).toBeTruthy();
  });

  it('renders notification items', async () => {
    const { getByText } = await render(<AdminNotificationsScreen />);
    expect(getByText('admin@taskflow.com')).toBeTruthy();
    expect(getByText('customer@ex.com')).toBeTruthy();
  });

  it('renders notification messages', async () => {
    const { getByText } = await render(<AdminNotificationsScreen />);
    expect(getByText('Appointment confirmed for John')).toBeTruthy();
    expect(getByText('Booking cancelled')).toBeTruthy();
  });

  it('renders notification type', async () => {
    const { getByText } = await render(<AdminNotificationsScreen />);
    expect(getByText('Type: APPOINTMENT_CONFIRMED')).toBeTruthy();
    expect(getByText('Type: CANCELLATION')).toBeTruthy();
  });

  it('renders NOTIFICATION OUTBOX badge', async () => {
    const { getByText } = await render(<AdminNotificationsScreen />);
    expect(getByText('NOTIFICATION OUTBOX')).toBeTruthy();
  });

  it('shows error state and retries when the outbox fails to load', async () => {
    mockIsError = true;
    await render(<AdminNotificationsScreen />);
    expect(screen.getByText("Couldn't load the notification outbox.")).toBeTruthy();
    expect(screen.queryByText('Outbox Empty')).toBeNull();
    await fireEvent.press(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
