import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CustomerPortalScreen } from '../src/features/customer/CustomerPortalScreen';
import type { AppointmentPage } from '../src/types/api';
import { freezeDate, moveClockTo, restoreClock } from '../test/fakeClock';

// ==================== Controllable mocks ====================
let mockIsLoading: boolean;
let mockIsError: boolean;
let mockIsFetching: boolean;
let mockIsPlaceholderData: boolean;
let mockIsFocused: boolean;
let mockCancelPending: boolean;
let mockCancelVariables: string | undefined;
let mockAppointmentsData: AppointmentPage;
let mockRefetch: jest.Mock;
let mockCancelMutate: jest.Mock;
let mockLogout: jest.Mock;
let mockUsername: string;
let mockHookArgs: unknown[];
let mockRescheduleMutate: jest.Mock;
let mockReschedulePending: boolean;
let mockBusySlots: {
  data?: string[];
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: jest.Mock;
};
let mockBusyArgs: unknown[];
const mockExportCalendar = jest.fn();
const mockShareCalendarFile = jest.fn();

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockIsFocused }));

// The picker's answer for the booking being moved (its barber and booked length).
jest.mock('../src/core/appointments/useAppointments', () => ({
  useRescheduleAvailability: (...args: unknown[]) => {
    mockBusyArgs = args;
    return mockBusySlots;
  },
}));

jest.mock('../src/features/customer/customer', () => ({
  customerApi: { exportCalendar: (...args: unknown[]) => mockExportCalendar(...args) },
}));

jest.mock('../src/core/calendar/shareCalendarFile', () => ({
  shareCalendarFile: (...args: unknown[]) => mockShareCalendarFile(...args),
}));

// The shop info (time zone, window, hours) as the server's defaults: no query client needed.
jest.mock('../src/core/shop/useShopInfo', () => ({
  useShopInfo: () => ({
    timeZone: null,
    rules: jest.requireActual('@taskflow/domain').DEFAULT_SHOP_RULES,
    loaded: false,
  }),
}));

jest.mock('../src/features/customer/useCustomer', () => ({
  useCustomerAppointments: (...args: unknown[]) => {
    mockHookArgs = args;
    return {
      data: mockAppointmentsData,
      isLoading: mockIsLoading,
      isError: mockIsError,
      isSuccess: !mockIsLoading && !mockIsError,
      isFetching: mockIsFetching,
      isPlaceholderData: mockIsPlaceholderData,
      refetch: mockRefetch,
    };
  },
  useCancelCustomerAppointment: () => ({
    mutate: mockCancelMutate,
    isPending: mockCancelPending,
    variables: mockCancelVariables,
  }),
  useRescheduleCustomerAppointment: () => ({
    mutate: mockRescheduleMutate,
    isPending: mockReschedulePending,
  }),
}));

jest.mock('../src/core/auth/useAuthStore', () => ({
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
  // Mid-July 2026: the fixture's August bookings are still upcoming, so they can be cancelled.
  beforeEach(() => freezeDate('2026-07-15T12:00:00'));
  afterEach(() => restoreClock());

  it('offers no cancel once a booking has started, as the server refuses it then', async () => {
    moveClockTo('2026-08-02T12:00:00');
    await render(<CustomerPortalScreen />);
    expect(screen.queryByText('Cancel Booking')).toBeNull();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLoading = false;
    mockIsError = false;
    mockIsFetching = false;
    mockIsPlaceholderData = false;
    mockIsFocused = true;
    mockCancelPending = false;
    mockCancelVariables = undefined;
    mockAppointmentsData = buildData();
    mockRefetch = jest.fn();
    mockCancelMutate = jest.fn();
    mockLogout = jest.fn();
    mockUsername = 'John';
    mockHookArgs = [];
    mockRescheduleMutate = jest.fn();
    mockReschedulePending = false;
    mockBusySlots = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
    mockBusyArgs = [];
  });

  // ============ RESCHEDULE & CALENDAR ============
  it('offers the booking’s open slots and moves it', async () => {
    mockBusySlots = { data: ['13:00'], isLoading: false, isError: false, refetch: jest.fn() };
    mockRescheduleMutate.mockImplementation((_vars, { onSuccess }) => onSuccess());
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Reschedule'));

    // Today (Wed 15 July, 12:00) is the first open day; the 1 PM the server refuses is not offered.
    expect(mockBusyArgs).toEqual(['TF-0001', '2026-07-15', null]);
    expect(screen.queryByText('1:00 PM')).toBeNull();
    expect(screen.queryByText('11:00 AM')).toBeNull();
    await fireEvent.press(screen.getByText('2:00 PM'));
    await fireEvent.press(screen.getByText('Save new time'));

    expect(mockRescheduleMutate).toHaveBeenCalledWith(
      { publicId: 'TF-0001', bookingDate: '2026-07-15', bookingTime: '14:00' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(screen.getByText('Appointment moved. It is pending the shop’s confirmation again.')).toBeTruthy(),
    );
    expect(screen.queryByText('Save new time')).toBeNull();
  });

  it('shows why the availability could not be loaded, with a retry', async () => {
    const refetch = jest.fn();
    mockBusySlots = {
      isLoading: false,
      isError: true,
      error: {
        response: {
          status: 409,
          data: { message: 'Only future pending or approved appointments can be rescheduled.' },
        },
      },
      refetch,
    };
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Reschedule'));

    expect(
      screen.getByText('Only future pending or approved appointments can be rescheduled.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps the picker open and shows why a move was refused', async () => {
    mockRescheduleMutate.mockImplementation((_vars, { onError }) =>
      onError({ response: { status: 409, data: { message: 'The selected slot is already booked or unavailable.' } } }),
    );
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Reschedule'));
    await fireEvent.press(screen.getByText('3:00 PM'));
    await fireEvent.press(screen.getByText('Save new time'));

    await waitFor(() =>
      expect(screen.getByText('The selected slot is already booked or unavailable.')).toBeTruthy(),
    );
    expect(screen.getByText('Save new time')).toBeTruthy();
  });

  it('shares the calendar file and reports a failed export', async () => {
    mockExportCalendar.mockResolvedValueOnce({ content: 'BEGIN:VCALENDAR', filename: 'appointment-TF-0001.ics' });
    mockShareCalendarFile.mockResolvedValueOnce(true);
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Add to Calendar'));
    await waitFor(() =>
      expect(mockShareCalendarFile).toHaveBeenCalledWith('BEGIN:VCALENDAR', 'appointment-TF-0001.ics'),
    );

    mockExportCalendar.mockRejectedValueOnce({ response: { status: 500, data: null } });
    await fireEvent.press(screen.getByText('Add to Calendar'));
    await waitFor(() => expect(screen.getByText('Failed to export the calendar file.')).toBeTruthy());
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

  it('shows error state and retries when bookings fail to load', async () => {
    mockIsError = true;
    await render(<CustomerPortalScreen />);
    expect(screen.getByText("Couldn't load your bookings.")).toBeTruthy();
    expect(screen.queryByText('No Bookings Found')).toBeNull();
    await fireEvent.press(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
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

  it('leaves the refresh after a cancel to the mutation hook', async () => {
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
    // useCancelCustomerAppointment invalidates ['customerAppointments']; a refetch here
    // would request the same page a second time.
    expect(mockRefetch).not.toHaveBeenCalled();
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
    expect(mockHookArgs).toEqual([1, 10, { subscribed: true }]);
    await fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(mockHookArgs).toEqual([2, 10, { subscribed: true }]);
    expect(screen.getByText('Next').parent?.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText('Next'));
    expect(mockHookArgs).toEqual([2, 10, { subscribed: true }]);
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
    expect(mockHookArgs).toEqual([0, 10, { subscribed: true }]);
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

  // ============ MOB-9: LOGOUT FAILURE ============
  it('shows a message instead of an unhandled rejection when logout cleanup fails', async () => {
    mockLogout.mockRejectedValueOnce(new Error('Secure credential removal failed. Please try signing out again.'));
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Sign Out'));
    await waitFor(() => {
      expect(screen.getByText(/Secure credential removal failed/)).toBeTruthy();
    });
  });

  // ============ CANCELLED STATUS ============
  it('shows CANCELLED and offers no cancel action for a cancelled booking', async () => {
    mockAppointmentsData = buildData({
      content: [{ ...defaultAppointment, status: 'CANCELLED' as any }],
    });
    await render(<CustomerPortalScreen />);
    expect(screen.getByText('CANCELLED')).toBeTruthy();
    expect(screen.queryByText('Cancel Booking')).toBeNull();
  });

  it('shows the server message when cancelling fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b: any) => b.text === 'Yes, Cancel')?.onPress?.();
    });
    mockCancelMutate.mockImplementation((_id, { onError }) => {
      onError({ response: { status: 400, data: { message: 'Too late to cancel' } } });
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    await waitFor(() => {
      expect(screen.getByText('Too late to cancel')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });

  it('subscribes only while the tab is focused', async () => {
    const { rerender } = await render(<CustomerPortalScreen />);
    expect(mockHookArgs[2]).toEqual({ subscribed: true });
    mockIsFocused = false;
    await rerender(<CustomerPortalScreen />);
    expect(mockHookArgs[2]).toEqual({ subscribed: false });
  });

  it('shows a spinner only for the cancelling row and disables other cancellations', async () => {
    mockAppointmentsData.content.push({ ...defaultAppointment, id: 2, publicId: 'TF-0002' });
    mockCancelPending = true;
    mockCancelVariables = 'TF-0001';
    await render(<CustomerPortalScreen />);
    const buttons = screen.getAllByLabelText('Cancel Booking');
    expect(buttons[0]!.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(buttons[1]!.props.accessibilityState).toEqual({ disabled: true, busy: false });
    await fireEvent.press(buttons[1]!);
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });

  it('guards repeated confirmation callbacks before mutation state re-renders', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const confirm = buttons?.find((b) => b.text === 'Yes, Cancel')?.onPress;
      confirm?.();
      confirm?.();
    });
    await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Cancel Booking'));
    expect(mockCancelMutate).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('waits for resolved metadata before clamping an empty page to zero', async () => {
    mockAppointmentsData.page.totalPages = 3;
    const { rerender } = await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Next'));
    mockAppointmentsData = buildData({
      content: [], page: { number: 1, size: 10, totalElements: 0, totalPages: 0 },
    });
    mockIsPlaceholderData = true;
    await rerender(<CustomerPortalScreen />);
    expect(mockHookArgs[0]).toBe(1);
    mockIsPlaceholderData = false;
    mockIsFetching = true;
    await rerender(<CustomerPortalScreen />);
    expect(mockHookArgs[0]).toBe(1);
    mockIsFetching = false;
    await rerender(<CustomerPortalScreen />);
    expect(mockHookArgs[0]).toBe(0);
  });

  it('offers recovery from an empty page that still reports more pages', async () => {
    mockAppointmentsData.page.totalPages = 3;
    const { rerender } = await render(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Next'));
    mockAppointmentsData = buildData({
      content: [], page: { number: 1, size: 10, totalElements: 20, totalPages: 3 },
    });
    await rerender(<CustomerPortalScreen />);
    await fireEvent.press(screen.getByText('Back to first page'));
    expect(mockHookArgs[0]).toBe(0);
  });
});
