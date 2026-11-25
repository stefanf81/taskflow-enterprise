import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { freezeDate, restoreClock } from '../test/fakeClock';

let mockRange: { from: string; to: string } | null = null;
let mockData: any[] | undefined;
let mockIsLoading = false;
let mockIsError = false;
const mockRefetch = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../src/core/shop/useShopInfo', () => ({ useShopInfo: () => ({ timeZone: null }) }));
jest.mock('../src/core/barbers/useBarbers', () => ({
  useAdminBarbers: () => ({ data: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sara' }] }),
}));
jest.mock('../src/core/appointments/useAppointments', () => ({
  useAppointmentsInRange: (from: string, to: string) => {
    mockRange = { from, to };
    return { data: mockData, isLoading: mockIsLoading, isError: mockIsError, refetch: mockRefetch };
  },
  useUpdateAppointmentStatus: () => ({ mutateAsync: mockUpdate }),
  useDeleteAppointment: () => ({ mutateAsync: mockDelete }),
}));

import { AdminCalendarScreen } from '../src/features/admin/AdminCalendarScreen';

const booking = (id: number, barberName: string, bookingTime: string, status = 'PENDING') => ({
  id,
  publicId: `TF-${id}`,
  customerName: `Customer ${id}`,
  customerEmail: `c${id}@ex.com`,
  customerPhone: '555',
  barberName,
  bookingDate: '2026-11-24',
  bookingTime,
  serviceType: 'Haircut',
  status,
  createdAt: '',
  updatedAt: '',
});

describe('AdminCalendarScreen', () => {
  beforeEach(() => {
    // 12:00 UTC on a Tuesday: the same date in any zone the shop could be in.
    freezeDate('2026-11-24T12:00:00Z');
    jest.clearAllMocks();
    mockData = [
      booking(1, 'Alex', '09:00', 'APPROVED'),
      booking(2, 'Sara', '10:30'),
      booking(3, 'Alex', '11:00', 'DENIED'),
    ];
    mockIsLoading = false;
    mockIsError = false;
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });
  afterEach(() => restoreClock());

  it('shows today with the bookings that hold a slot, earliest first', async () => {
    await render(<AdminCalendarScreen />);

    expect(mockRange).toEqual({ from: '2026-11-24', to: '2026-11-24' });
    expect(screen.getByText('Tuesday, November 24, 2026')).toBeTruthy();
    expect(screen.getByText('2 bookings')).toBeTruthy();
    expect(screen.getByText('Customer 1')).toBeTruthy();
    expect(screen.getByText('Customer 2')).toBeTruthy();
    expect(screen.queryByText('Customer 3')).toBeNull(); // denied: its slot is free again
  });

  it('pages by day and week, and Today comes back', async () => {
    await render(<AdminCalendarScreen />);

    await fireEvent.press(screen.getByLabelText('Next day'));
    expect(mockRange).toEqual({ from: '2026-11-25', to: '2026-11-25' });

    await fireEvent.press(screen.getByLabelText('Week view'));
    expect(mockRange).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(screen.getByText('Nov 23 – Nov 29, 2026')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Next week'));
    expect(mockRange).toEqual({ from: '2026-11-30', to: '2026-12-06' });

    await fireEvent.press(screen.getByLabelText('Today'));
    expect(mockRange).toEqual({ from: '2026-11-23', to: '2026-11-29' });
  });

  it('narrows to one barber', async () => {
    await render(<AdminCalendarScreen />);

    await fireEvent.press(screen.getByLabelText('Barber Sara'));
    expect(screen.getByText('Customer 2')).toBeTruthy();
    expect(screen.queryByText('Customer 1')).toBeNull();
    expect(screen.getByText('1 booking')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('All barbers'));
    expect(screen.getByText('Customer 1')).toBeTruthy();
  });

  it('opens a booking to approve it', async () => {
    await render(<AdminCalendarScreen />);
    expect(screen.queryByText('Approve')).toBeNull();

    await fireEvent.press(screen.getByText('Customer 2'));
    expect(screen.getByText('c2@ex.com • 555')).toBeTruthy();
    await fireEvent.press(screen.getByText('Approve'));

    expect(mockUpdate).toHaveBeenCalledWith({ id: 2, status: 'APPROVED' });
  });

  it('offers no Approve for an approved booking', async () => {
    await render(<AdminCalendarScreen />);
    await fireEvent.press(screen.getByText('Customer 1'));
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('keeps the loaded bookings when a background refetch fails', async () => {
    mockIsError = true;
    await render(<AdminCalendarScreen />);
    expect(
      screen.getByText("Couldn't refresh the calendar. Showing the last loaded bookings."),
    ).toBeTruthy();
    expect(screen.getByText('Customer 1')).toBeTruthy();
    expect(screen.queryByText("Couldn't load the calendar.")).toBeNull();
  });

  it('lists a former barber only while one of their bookings holds a slot', async () => {
    mockData = [booking(1, 'Alex', '09:00'), booking(4, 'Jordan', '11:00', 'CANCELLED')];
    const view = await render(<AdminCalendarScreen />);
    expect(screen.queryByLabelText('Barber Jordan')).toBeNull();

    mockData = [booking(1, 'Alex', '09:00'), booking(5, 'Kim', '12:00')];
    await view.rerender(<AdminCalendarScreen />);
    await fireEvent.press(screen.getByLabelText('Barber Kim'));
    expect(screen.queryByText('Customer 1')).toBeNull();

    // Kim's booking is cancelled: Kim leaves the list, and every barber is shown again.
    mockData = [booking(1, 'Alex', '09:00'), booking(5, 'Kim', '12:00', 'CANCELLED')];
    await view.rerender(<AdminCalendarScreen />);
    expect(screen.queryByLabelText('Barber Kim')).toBeNull();
    expect(screen.getByLabelText('All barbers').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText('Customer 1')).toBeTruthy();
  });

  it('says so when nothing is booked, and retries a failed load', async () => {
    mockData = [];
    const view = await render(<AdminCalendarScreen />);
    expect(screen.getByText('Nothing booked')).toBeTruthy();

    mockIsError = true;
    mockData = undefined;
    await view.rerender(<AdminCalendarScreen />);
    await fireEvent.press(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
