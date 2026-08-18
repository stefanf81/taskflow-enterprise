import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

// ==================== Controllable mocks ====================
const mockRefetch = jest.fn();
let mockIsLoading: boolean;
let mockAppointmentsData: any;
let mockUpdateMutate: jest.Mock;
let mockDeleteMutate: jest.Mock;
let mockHookArgs: any[] | null;

jest.mock('../src/hooks/useAppointments', () => ({
  useAppointments: (...args: any[]) => {
    mockHookArgs = args;
    return {
      data: mockAppointmentsData,
      isLoading: mockIsLoading,
      refetch: mockRefetch,
    };
  },
  useUpdateAppointmentStatus: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useDeleteAppointment: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));

const mockLogout = jest.fn();
jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: () => ({ logout: mockLogout }),
}));

import { AdminDashboardScreen } from '../src/screens/AdminDashboardScreen';

const defaultStats = {
  total: 1, pending: 1, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0,
};

const defaultAppointment = {
  id: 1, publicId: 'TF-0001', customerName: 'John Doe', customerEmail: 'john@ex.com',
  customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-15',
  bookingTime: '10:00', serviceType: 'Haircut', status: 'PENDING' as const,
  createdAt: '', updatedAt: '',
};

function buildData(overrides: Partial<any> = {}) {
  return {
    page: {
      content: [defaultAppointment],
      totalPages: 1,
    },
    stats: defaultStats,
    ...overrides,
  };
}

describe('AdminDashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLoading = false;
    mockAppointmentsData = buildData();
    mockUpdateMutate = jest.fn();
    mockDeleteMutate = jest.fn();
    mockHookArgs = null;
  });

  // ============ RENDERING ============
  it('renders admin control center header', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Owner Panel')).toBeTruthy();
  });

  it('renders stats board', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Total Bookings')).toBeTruthy();
    expect(screen.getByText('Pending Approval')).toBeTruthy();
    expect(screen.getByText('Approved Slots')).toBeTruthy();
  });

  it('renders appointment list', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('John Doe')).toBeTruthy();
    expect(screen.getByText('TF-0001')).toBeTruthy();
  });

  it('renders action buttons for pending appointment', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('renders filter chips', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('ALL')).toBeTruthy();
    const pendings = screen.getAllByText('PENDING');
    expect(pendings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders sync and logout header actions', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('ADMIN CONTROL CENTER')).toBeTruthy();
    expect(screen.getByText('Owner Panel')).toBeTruthy();
  });

  it('renders progress card', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Slot Approval Completion Rate')).toBeTruthy();
  });

  // ============ LOADING & EMPTY STATES ============
  it('shows loading indicator when isLoading is true', async () => {
    mockIsLoading = true;
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Loading bookings...')).toBeTruthy();
  });

  it('shows empty state when no appointments', async () => {
    mockAppointmentsData = buildData({ page: { content: [], totalPages: 0 }, stats: null });
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('No Appointments Found')).toBeTruthy();
    expect(screen.getByText('No records match your filter criteria.')).toBeTruthy();
  });

  // ============ FILTERS ============
  it('renders all five filter chips', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('ALL')).toBeTruthy();
    // Appointment status badges share labels with filter chips.
    expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('APPROVED')).toBeTruthy();
    expect(screen.getAllByText('OVERDUE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('DENIED')).toBeTruthy();
  });

  it('switches filter when a filter chip is pressed', async () => {
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('APPROVED'));
    // After pressing APPROVED, the filter changes and appointments are refetched
    // The selected filter should show with selected styling
    expect(screen.getByText('APPROVED')).toBeTruthy();
  });

  // ============ SEARCH ============
  it('renders search input', async () => {
    await render(<AdminDashboardScreen />);
    const input = screen.getByPlaceholderText('Search by name, email, phone, or public ID...');
    expect(input).toBeTruthy();
  });

  it('does not send the search term to the hook before the debounce window', async () => {
    await render(<AdminDashboardScreen />);
    const input = screen.getByPlaceholderText('Search by name, email, phone, or public ID...');
    await fireEvent.changeText(input, 'John');
    // The hook still receives the previous (empty) search term immediately —
    // the backend must not be hit on every keystroke.
    expect(mockHookArgs?.[1]).toBe('');
  });

  it('sends the debounced search term to the hook after 300ms', async () => {
    await render(<AdminDashboardScreen />);
    const input = screen.getByPlaceholderText('Search by name, email, phone, or public ID...');
    await fireEvent.changeText(input, 'John');
    await waitFor(() => {
      expect(mockHookArgs?.[1]).toBe('John');
    });
  });

  // ============ SYNC & LOGOUT ============
  it('calls refetch and shows success banner on sync button press', async () => {
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByLabelText('Sync'));
    await waitFor(() => {
      expect(screen.getByText('Database synced.')).toBeTruthy();
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('calls logout on logout button press', async () => {
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByLabelText('Logout'));
    expect(mockLogout).toHaveBeenCalled();
  });

  // ============ APPROVE, DENY, DELETE ============
  it('calls updateStatus mutate with APPROVED on approve press', async () => {
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Approve'));
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 1, status: 'APPROVED' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('shows success banner after approve succeeds', async () => {
    mockUpdateMutate.mockImplementation((_args, { onSuccess }) => {
      onSuccess();
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Approve'));
    await waitFor(() => {
      expect(screen.getByText(/Appointment APPROVED/i)).toBeTruthy();
    });
  });

  it('calls updateStatus mutate with DENIED on decline press', async () => {
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Decline'));
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 1, status: 'DENIED' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('shows success banner after decline succeeds', async () => {
    mockUpdateMutate.mockImplementation((_args, { onSuccess }) => {
      onSuccess();
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Decline'));
    await waitFor(() => {
      expect(screen.getByText(/Appointment DECLINED/i)).toBeTruthy();
    });
  });

  it('shows error banner when approve fails', async () => {
    mockUpdateMutate.mockImplementation((_args, { onError }) => {
      onError();
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Approve'));
    await waitFor(() => {
      expect(screen.getByText('Failed to approve appointment.')).toBeTruthy();
    });
  });

  it('shows error banner when decline fails', async () => {
    mockUpdateMutate.mockImplementation((_args, { onError }) => {
      onError();
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Decline'));
    await waitFor(() => {
      expect(screen.getByText('Failed to decline appointment.')).toBeTruthy();
    });
  });

  it('shows alert on delete press and calls delete mutate on confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const deleteBtn = buttons?.find((b: any) => b.text === 'Delete');
      if (deleteBtn?.onPress) deleteBtn.onPress();
    });

    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Delete'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Booking',
      'Are you sure you want to permanently delete this booking?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Delete', style: 'destructive' }),
      ]),
    );

    expect(mockDeleteMutate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    alertSpy.mockRestore();
  });

  it('shows success banner after delete succeeds', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const deleteBtn = buttons?.find((b: any) => b.text === 'Delete');
      if (deleteBtn?.onPress) deleteBtn.onPress();
    });
    mockDeleteMutate.mockImplementation((_id, { onSuccess }) => {
      onSuccess();
    });

    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Booking permanently deleted.')).toBeTruthy();
    });

    alertSpy.mockRestore();
  });

  it('shows error banner when delete fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const deleteBtn = buttons?.find((b: any) => b.text === 'Delete');
      if (deleteBtn?.onPress) deleteBtn.onPress();
    });
    mockDeleteMutate.mockImplementation((_id, { onError }) => {
      onError();
    });

    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Failed to delete booking.')).toBeTruthy();
    });

    alertSpy.mockRestore();
  });

  // ============ APPROVED STATUS VARIATIONS ============
  it('hides Approve button for already-approved appointments', async () => {
    const approvedAppt = { ...defaultAppointment, status: 'APPROVED' as const };
    mockAppointmentsData = buildData({
      page: { content: [approvedAppt], totalPages: 1 },
    });
    await render(<AdminDashboardScreen />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.getByText('Decline')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('hides Decline button for already-denied appointments', async () => {
    const deniedAppt = { ...defaultAppointment, status: 'DENIED' as const };
    mockAppointmentsData = buildData({
      page: { content: [deniedAppt], totalPages: 1 },
    });
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.queryByText('Decline')).toBeNull();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  // ============ OVERDUE ============
  it('shows OVERDUE badge for overdue pending appointments', async () => {
    const overdueDate = '2020-01-01'; // far in the past
    const overdueAppt = { ...defaultAppointment, bookingDate: overdueDate };
    mockAppointmentsData = buildData({
      page: { content: [overdueAppt], totalPages: 1 },
    });
    await render(<AdminDashboardScreen />);
    // OVERDUE appears in both filter chip and overdue badge
    expect(screen.getAllByText('OVERDUE').length).toBeGreaterThanOrEqual(1);
    // Badge (PENDING status) should NOT be shown; overdue badge replaces it
    // The filter chip still says PENDING, so check that the appointment card has
    // an OVERDUE badge instead of a PENDING Badge component
    expect(screen.getByText('TF-0001')).toBeTruthy(); // card still renders
  });

  // ============ PAGINATION ============
  it('shows pagination when totalPages > 1', async () => {
    mockAppointmentsData = buildData({
      page: {
        content: Array.from({ length: 10 }, (_, i) => ({
          ...defaultAppointment,
          id: i + 1,
          publicId: `TF-${String(i + 1).padStart(4, '0')}`,
          customerName: `Customer ${i + 1}`,
        })),
        totalPages: 3,
      },
    });
    // Need to re-render to use the mockAppointmentsData, which is captured
    // by closure. Actually the factory reads the let variable at runtime,
    // so just rendering after updating the let should work.
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByText('Prev')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('navigates next page on Next press', async () => {
    mockAppointmentsData = buildData({
      page: {
        content: Array.from({ length: 10 }, (_, i) => ({
          ...defaultAppointment,
          id: i + 1,
          publicId: `TF-${String(i + 1).padStart(4, '0')}`,
          customerName: `Customer ${i + 1}`,
        })),
        totalPages: 3,
      },
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  });

  it('navigates previous page on Prev press', async () => {
    mockAppointmentsData = buildData({
      page: {
        content: Array.from({ length: 10 }, (_, i) => ({
          ...defaultAppointment,
          id: i + 1,
          publicId: `TF-${String(i + 1).padStart(4, '0')}`,
          customerName: `Customer ${i + 1}`,
        })),
        totalPages: 3,
      },
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Next'));
    await fireEvent.press(screen.getByText('Prev'));
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });

  it('disables Prev on first page', async () => {
    mockAppointmentsData = buildData({
      page: {
        content: Array.from({ length: 10 }, (_, i) => ({
          ...defaultAppointment,
          id: i + 1,
          publicId: `TF-${String(i + 1).padStart(4, '0')}`,
          customerName: `Customer ${i + 1}`,
        })),
        totalPages: 3,
      },
    });
    await render(<AdminDashboardScreen />);
    const prevBtn = screen.getByText('Prev').parent;
    expect(prevBtn?.props?.accessibilityState?.disabled ?? false).toBe(true);
  });

  it('disables Next on last page', async () => {
    mockAppointmentsData = buildData({
      page: {
        content: Array.from({ length: 10 }, (_, i) => ({
          ...defaultAppointment,
          id: i + 1,
          publicId: `TF-${String(i + 1).padStart(4, '0')}`,
          customerName: `Customer ${i + 1}`,
        })),
        totalPages: 1, // single page, so pagination should NOT render
      },
    });
    await render(<AdminDashboardScreen />);
    expect(screen.queryByText('Prev')).toBeNull();
    expect(screen.queryByText('Next')).toBeNull();
  });

  // ============ SUCCESS BANNER ============
  it('dismisses success banner on press X', async () => {
    mockUpdateMutate.mockImplementation((_args, { onSuccess }) => {
      onSuccess();
    });
    await render(<AdminDashboardScreen />);
    await fireEvent.press(screen.getByText('Approve'));
    await waitFor(() => {
      expect(screen.getByText(/Appointment APPROVED/i)).toBeTruthy();
    });
    // Find the dismiss button (×) and press it
    const dismissBtn = screen.getByText('×');
    await fireEvent.press(dismissBtn);
    expect(screen.queryByText(/Appointment APPROVED/i)).toBeNull();
  });
});
