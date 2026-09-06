import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CustomerPortalScreen } from '../src/screens/CustomerPortalScreen';
import type { AppointmentPage } from '../src/types/api';

// ==================== Controllable mocks ====================
let mockIsLoading: boolean;
let mockAppointmentsData: AppointmentPage;
let mockRefetch: jest.Mock;
let mockCancelMutate: jest.Mock;
let mockLogout: jest.Mock;
let mockUsername: string;
let mockHookArgs: unknown[];

jest.mock('../src/hooks/useCustomer', () => ({
  useCustomerAppointments: (...args: unknown[]) => {
    mockHookArgs = args;
    return {
      data: mockAppointmentsData,
      isLoading: mockIsLoading,
      refetch: mockRefetch,
    };
  },
  useCancelCustomerAppointment: () => ({
    mutate: mockCancelMutate,
    isPending: false,
  }),
}));

jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: () => ({
    username: mockUsername,
    logout: mockLogout,
  }),
}));

const defaultAppointment = {
  id: 1, publicId: 'TF-0001', customerName: 'John', customerEmail: 'j@ex.com',
  customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-01',
  bookingTime: '10:00', serviceType: 'Haircut', status: 'PENDING' as const,
  createdAt: '', updatedAt: '',
};

function buildData(overrides: Partial<AppointmentPage> = {}): AppointmentPage {
  return {
    content: [defaultAppointment],
    page: { number: 0, size: 10, totalElements: 1, totalPages: 1 },
    ...overrides,
  };
}

describe('CustomerPortalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLoading = false;
    mockAppointmentsData = buildData();
    mockRefetch = jest.fn();
    mockCancelMutate = jest.fn();
    mockLogout = jest.fn();
    mockUsername = 'John';
    mockHookArgs = [];
  });

  // ============ RENDERING ============
  it('renders welcome greeting', async () => {
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Welcome Back')).toBeTruthy();
    expect(screen.getByText('John')).toBeTruthy();
  });

  it('renders appointments list', async () => {
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('TF-0001')).toBeTruthy();
    expect(screen.getByText('Haircut')).toBeTruthy();
  });

  it('renders section title', async () => {
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('My Bookings')).toBeTruthy();
  });

  it('renders sign out button', async () => {
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Sign Out')).toBeTruthy();
  });

  it('renders cancel button for pending appointments', async () => {
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Cancel Booking')).toBeTruthy();
  });

  it('renders username from auth store', async () => {
    mockUsername = 'Jane Doe';
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('shows "Valued Customer" when no username', async () => {
    mockUsername = '';
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Valued Customer')).toBeTruthy();
  });

  // ============ LOADING & EMPTY STATES ============
  it('shows loading indicator when isLoading is true', async () => {
    mockIsLoading = true;
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Loading your appointments...')).toBeTruthy();
  });

  it('shows empty state when no appointments', async () => {
    mockAppointmentsData = buildData({
      content: [], page: { number: 0, size: 10, totalElements: 0, totalPages: 0 },
    });
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('No Bookings Found')).toBeTruthy();
    expect(screen.getByText("You haven't reserved any appointments yet.")).toBeTruthy();
  });

  // ============ SIGN OUT ============
  it('calls logout when sign out pressed', async () => {
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Sign Out'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  // ============ CANCEL BOOKING ============
  it('shows alert dialog on cancel booking press', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel Appointment',
      'Are you sure you want to cancel this booking?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'No', style: 'cancel' }),
        expect.objectContaining({ text: 'Yes, Cancel', style: 'destructive' }),
      ]),
    );
    alertSpy.mockRestore();
  });

  it('calls cancel mutation when cancel confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.text === 'Yes, Cancel');
      if (confirmBtn?.onPress) confirmBtn.onPress();
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    expect(mockCancelMutate).toHaveBeenCalledWith(
      'TF-0001',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    alertSpy.mockRestore();
  });

  it('shows success banner after cancel succeeds', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.text === 'Yes, Cancel');
      if (confirmBtn?.onPress) confirmBtn.onPress();
    });
    mockCancelMutate.mockImplementation((_id, { onSuccess }) => {
      onSuccess();
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    await waitFor(() => {
      expect(screen.getByText('Appointment cancelled successfully.')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });

  it('shows error banner after cancel fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.text === 'Yes, Cancel');
      if (confirmBtn?.onPress) confirmBtn.onPress();
    });
    mockCancelMutate.mockImplementation((_id, { onError }) => {
      onError();
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    await waitFor(() => {
      expect(screen.getByText('Failed to cancel appointment.')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });

  it('calls refetch after cancel succeeds', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.text === 'Yes, Cancel');
      if (confirmBtn?.onPress) confirmBtn.onPress();
    });
    mockCancelMutate.mockImplementation((_id, { onSuccess }) => {
      onSuccess();
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });

  // ============ DENIED STATUS (NO CANCEL BUTTON) ============
  it('hides Cancel Booking button for denied appointments', async () => {
    const deniedAppt = { ...defaultAppointment, status: 'DENIED' as const };
    mockAppointmentsData = buildData({ content: [deniedAppt] });
    await render(<CustomerPortalScreen />);
    expect(screen.queryByText('Cancel Booking')).toBeNull();
  });

  // ============ PAGINATION ============
  it('shows pagination from nested VIA_DTO metadata when totalPages > 1', async () => {
    mockAppointmentsData = buildData({
      content: Array.from({ length: 10 }, (_, i) => ({
        ...defaultAppointment,
        id: i + 1,
        publicId: `TF-${String(i + 1).padStart(4, '0')}`,
        customerName: `Customer ${i + 1}`,
      })),
      page: { number: 0, size: 10, totalElements: 25, totalPages: 3 },
    });
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByText('Prev')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('navigates to next page on Next press', async () => {
    mockAppointmentsData = buildData({
      content: Array.from({ length: 10 }, (_, i) => ({
        ...defaultAppointment,
        id: i + 1,
        publicId: `TF-${String(i + 1).padStart(4, '0')}`,
        customerName: `Customer ${i + 1}`,
      })),
      page: { number: 0, size: 10, totalElements: 25, totalPages: 3 },
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    expect(mockHookArgs).toEqual([1, 10]);
    await fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(mockHookArgs).toEqual([2, 10]);
    expect(screen.getByText('Next').parent?.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText('Next'));
    expect(mockHookArgs).toEqual([2, 10]);
  });

  it('navigates to previous page on Prev press', async () => {
    mockAppointmentsData = buildData({
      content: Array.from({ length: 10 }, (_, i) => ({
        ...defaultAppointment,
        id: i + 1,
        publicId: `TF-${String(i + 1).padStart(4, '0')}`,
        customerName: `Customer ${i + 1}`,
      })),
      page: { number: 0, size: 10, totalElements: 25, totalPages: 3 },
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Next'));
    await fireEvent.press(screen.getByText('Prev'));
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(mockHookArgs).toEqual([0, 10]);
  });

  it('does not show pagination when single page', async () => {
    mockAppointmentsData = buildData();
    await render(<CustomerPortalScreen />);
    expect(screen.queryByText('Prev')).toBeNull();
    expect(screen.queryByText('Next')).toBeNull();
  });

  // ============ BANNER DISMISS ============
  it('dismisses success banner on press X', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.text === 'Yes, Cancel');
      if (confirmBtn?.onPress) confirmBtn.onPress();
    });
    mockCancelMutate.mockImplementation((_id, { onSuccess }) => {
      onSuccess();
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    await waitFor(() => {
      expect(screen.getByText('Appointment cancelled successfully.')).toBeTruthy();
    });
    const dismissBtn = screen.getByText('×');
    await fireEvent.press(dismissBtn);
    expect(screen.queryByText('Appointment cancelled successfully.')).toBeNull();
    alertSpy.mockRestore();
  });
});
