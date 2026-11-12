import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { freezeDate, restoreClock } from '../test/fakeClock';

const mockMutate = jest.fn();
let mockAvailabilityArgs: unknown[] = [];
let mockAvailability: { data?: string[]; isLoading: boolean; isError: boolean; error?: unknown; refetch: jest.Mock };

jest.mock('../src/core/appointments/useAppointments', () => ({
  usePublicRescheduleAppointment: () => ({ mutate: mockMutate, isPending: false }),
  useRescheduleAvailability: (...args: unknown[]) => {
    mockAvailabilityArgs = args;
    return mockAvailability;
  },
}));

// The server's default rules (Mon-Sat 09:00-17:00, 90 days); no query client needed.
jest.mock('../src/core/shop/useShopInfo', () => ({
  useShopInfo: () => ({
    timeZone: null,
    rules: jest.requireActual('@taskflow/domain').DEFAULT_SHOP_RULES,
    loaded: false,
  }),
}));

import { PublicRescheduleModal } from '../src/features/landing/PublicRescheduleModal';

const ID = '123e4567-e89b-12d3-a456-426614174000';

describe('PublicRescheduleModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Wednesday 15 July 2026, noon on the shop's clock.
    freezeDate('2026-07-15T12:00:00');
    mockAvailabilityArgs = [];
    mockAvailability = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
  });
  afterEach(() => restoreClock());

  const openPicker = async () => {
    await render(
      <PublicRescheduleModal visible initialPublicId={` ${ID.toUpperCase()} `} onClose={() => {}} onSuccess={() => {}} />,
    );
    await fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), ' jane@example.com ');
    await fireEvent.press(screen.getByText('Choose a new time'));
  };

  it('asks for the reference and email before offering new times', async () => {
    await render(<PublicRescheduleModal visible onClose={() => {}} onSuccess={() => {}} />);
    await fireEvent.press(screen.getByText('Choose a new time'));

    expect(screen.getByText('Both Public Reference ID and Customer Email are required.')).toBeTruthy();
    expect(screen.queryByText('Save new time')).toBeNull();
  });

  it('offers the slots the server allows for the verified booking and moves it', async () => {
    mockAvailability = { data: ['15:00'], isLoading: false, isError: false, refetch: jest.fn() };
    await openPicker();

    // Asked for this booking (normalized reference, trimmed email) on the first open day.
    expect(mockAvailabilityArgs).toEqual([ID, '2026-07-15', 'jane@example.com']);
    expect(screen.queryByText('11:00 AM')).toBeNull();
    expect(screen.queryByText('3:00 PM')).toBeNull();
    await fireEvent.press(screen.getByText('2:00 PM'));
    await fireEvent.press(screen.getByText('Save new time'));

    expect(mockMutate).toHaveBeenCalledWith(
      { publicId: ID, email: 'jane@example.com', bookingDate: '2026-07-15', bookingTime: '14:00' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('says so in the picker when the reference and email do not match a booking', async () => {
    mockAvailability = {
      isLoading: false,
      isError: true,
      error: { response: { status: 404, data: { message: 'Appointment not found or unauthorized.' } } },
      refetch: jest.fn(),
    };
    await openPicker();

    expect(screen.getByText('Appointment not found or unauthorized.')).toBeTruthy();
    expect(screen.queryByText('2:00 PM')).toBeNull();
  });

  it('closes the picker when the reference or email is edited, so it never moves another booking', async () => {
    await openPicker();
    expect(screen.getByText('Save new time')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), 'other@example.com');

    expect(screen.queryByText('Save new time')).toBeNull();
    expect(screen.getByText('Choose a new time')).toBeTruthy();
  });

  it('reports the move and closes on success', async () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();
    mockMutate.mockImplementation((_vars, options) =>
      options.onSuccess({ bookingDate: '2026-07-15', bookingTime: '14:00' }),
    );
    await render(
      <PublicRescheduleModal visible initialPublicId={ID} onClose={onClose} onSuccess={onSuccess} />,
    );
    await fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), 'jane@example.com');
    await fireEvent.press(screen.getByText('Choose a new time'));
    await fireEvent.press(screen.getByText('2:00 PM'));
    await fireEvent.press(screen.getByText('Save new time'));

    expect(onSuccess).toHaveBeenCalledWith(
      'Booking moved to 2026-07-15 at 2:00 PM. The shop will confirm it again.',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the picker and shows the server’s reason when the move is refused', async () => {
    mockMutate.mockImplementation((_vars, options) =>
      options.onError({ response: { status: 409, data: { message: 'The selected slot is already booked or unavailable.' } } }),
    );
    await openPicker();
    await fireEvent.press(screen.getByText('3:00 PM'));
    await fireEvent.press(screen.getByText('Save new time'));

    await waitFor(() =>
      expect(screen.getByText('The selected slot is already booked or unavailable.')).toBeTruthy(),
    );
    expect(screen.getByText('Save new time')).toBeTruthy();
  });

  it('clears typed email when closed and reopened', async () => {
    const { rerender } = await render(
      <PublicRescheduleModal visible initialPublicId={ID} onClose={() => {}} onSuccess={() => {}} />,
    );
    await fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), 'stale@example.com');

    await rerender(
      <PublicRescheduleModal visible={false} initialPublicId={ID} onClose={() => {}} onSuccess={() => {}} />,
    );
    await rerender(
      <PublicRescheduleModal visible initialPublicId={ID} onClose={() => {}} onSuccess={() => {}} />,
    );

    expect(screen.queryByDisplayValue('stale@example.com')).toBeNull();
  });
});
