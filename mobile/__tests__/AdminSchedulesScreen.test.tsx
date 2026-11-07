import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AdminSchedulesScreen } from '../src/features/admin/AdminSchedulesScreen';

const mockMutateAsync = jest.fn();
const mockPreviewMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockCreateMutate = jest.fn();
const mockScheduleRefetch = jest.fn();
let mockSchedule: { data?: { days: { dayOfWeek: number; opens: string; closes: string }[]; revision: string }; isError: boolean };

jest.mock('../src/core/barbers/useBarbers', () => ({
  useAdminBarbers: () => ({
    data: [
      { id: 1, name: 'Alex the Barber', email: '', phone: '' },
      { id: 2, name: 'Sara the Stylist', email: '', phone: '' },
    ],
    isLoading: false,
  }),
  useBarberTimeOff: () => ({
    data: [{ startDate: '2026-08-01', endDate: '2026-08-03', reason: 'Vacation' }],
    isLoading: false,
  }),
  useAddTimeOff: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useBarberSchedule: () => ({ ...mockSchedule, refetch: mockScheduleRefetch }),
  usePreviewBarberSchedule: () => ({ mutate: mockPreviewMutate, isPending: false }),
  useUpdateBarberSchedule: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useCreateBarber: () => ({ mutate: mockCreateMutate, isPending: false }),
}));

describe('AdminSchedulesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchedule = {
      data: {
        days: [
          { dayOfWeek: 1, opens: '09:00', closes: '17:00' },
          { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
        ],
        revision: 'rev-1',
      },
      isError: false,
    };
  });

  it('renders schedules title', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('Barbers, Hours & Time-Off')).toBeTruthy();
  });

  it('renders barber selection chips', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('Alex the Barber')).toBeTruthy();
    expect(getByText('Sara the Stylist')).toBeTruthy();
  });

  it('renders scheduled time-off entries', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('2026-08-01 → 2026-08-03')).toBeTruthy();
    expect(getByText('Reason: Vacation')).toBeTruthy();
  });

  it('shows validation error when dates are missing', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    await fireEvent.press(getByText('Add Time-Off Record'));
    expect(getByText('Start date and end date are required.')).toBeTruthy();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  describe('weekly hours', () => {
    const closes = (day: string) => screen.getByLabelText(`${day} closes`);

    it('shows the loaded week, closed days as not working, and nothing to review yet', async () => {
      await render(<AdminSchedulesScreen />);
      expect(closes('Monday').props.value).toBe('17:00');
      expect(screen.getAllByText('Not working')).toHaveLength(5);
      expect(screen.getByText('Review changes').parent?.props.accessibilityState.disabled).toBe(true);
    });

    it('previews, requires confirming the cancellations, then saves with both revisions', async () => {
      mockPreviewMutate.mockImplementation((_vars, { onSuccess }) =>
        onSuccess({ conflictCount: 2, conflictsRevision: 'c-1' }),
      );
      mockUpdateMutate.mockImplementation((_vars, { onSuccess }) => onSuccess());
      await render(<AdminSchedulesScreen />);

      await fireEvent.changeText(closes('Monday'), '15:00');
      await fireEvent.press(screen.getByText('Review changes'));
      expect(mockPreviewMutate).toHaveBeenCalledWith(
        {
          barberId: 1,
          data: {
            days: [
              { dayOfWeek: 1, opens: '09:00', closes: '15:00' },
              { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
            ],
            expectedRevision: 'rev-1',
            cancelConflictingAppointments: false,
          },
        },
        expect.anything(),
      );

      expect(screen.getByText(/2 upcoming booking\(s\) fall outside the new hours/)).toBeTruthy();
      const save = () => screen.getByText('Save and cancel 2 booking(s)');
      await fireEvent.press(save());
      expect(mockUpdateMutate).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByText('Cancel these 2 booking(s)'));
      await fireEvent.press(save());
      expect(mockUpdateMutate).toHaveBeenCalledWith(
        {
          barberId: 1,
          data: {
            days: [
              { dayOfWeek: 1, opens: '09:00', closes: '15:00' },
              { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
            ],
            expectedRevision: 'rev-1',
            expectedConflicts: 'c-1',
            cancelConflictingAppointments: true,
          },
        },
        expect.anything(),
      );
      await waitFor(() => expect(screen.getByText('Weekly schedule updated.')).toBeTruthy());
    });

    it('asks for a fresh review after a refused save, even when the reloaded week is the same', async () => {
      mockPreviewMutate.mockImplementation((_vars, { onSuccess }) =>
        onSuccess({ conflictCount: 1, conflictsRevision: 'c-1' }),
      );
      // Only the affected bookings changed: the reloaded schedule keeps its revision, so the
      // editor is not remounted and must drop the spent preview itself.
      mockUpdateMutate.mockImplementation((_vars, { onError, onSettled }) => {
        onError({
          response: {
            status: 409,
            data: { message: 'The affected bookings changed. Review the change again.' },
          },
        });
        onSettled();
      });
      await render(<AdminSchedulesScreen />);

      await fireEvent.changeText(closes('Monday'), '15:00');
      await fireEvent.press(screen.getByText('Review changes'));
      await fireEvent.press(screen.getByText('Cancel these 1 booking(s)'));
      await fireEvent.press(screen.getByText('Save and cancel 1 booking(s)'));

      await waitFor(() =>
        expect(
          screen.getByText('The affected bookings changed. Review the change again.'),
        ).toBeTruthy(),
      );
      expect(screen.queryByText('Save and cancel 1 booking(s)')).toBeNull();
      expect(screen.getByText('Review changes').parent?.props.accessibilityState.disabled).toBe(false);
      await fireEvent.press(screen.getByText('Review changes'));
      expect(mockPreviewMutate).toHaveBeenCalledTimes(2);
      // The new preview starts unconfirmed.
      expect(
        screen.getByText('Save and cancel 1 booking(s)').parent?.props.accessibilityState.disabled,
      ).toBe(true);
    });

    it('refuses an invalid shift before asking the server', async () => {
      await render(<AdminSchedulesScreen />);
      await fireEvent.changeText(closes('Monday'), '08:00');
      expect(screen.getByText('Monday: use HH:mm and open before closing.')).toBeTruthy();
      await fireEvent.press(screen.getByText('Review changes'));
      expect(mockPreviewMutate).not.toHaveBeenCalled();
    });

    it('shows the server’s reason when the schedule changed meanwhile', async () => {
      mockPreviewMutate.mockImplementation((_vars, { onError }) =>
        onError({ response: { status: 409, data: { message: 'The schedule changed. Reload it before saving.' } } }),
      );
      await render(<AdminSchedulesScreen />);
      await fireEvent.changeText(closes('Monday'), '16:00');
      await fireEvent.press(screen.getByText('Review changes'));

      await waitFor(() =>
        expect(screen.getByText('The schedule changed. Reload it before saving.')).toBeTruthy(),
      );
    });

    it('offers a retry when the weekly hours cannot be loaded', async () => {
      mockSchedule = { data: undefined, isError: true };
      await render(<AdminSchedulesScreen />);
      expect(screen.getByText('Could not load the weekly hours.')).toBeTruthy();
      await fireEvent.press(screen.getByText('Retry'));
      expect(mockScheduleRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('add barber', () => {
    it('requires a name', async () => {
      await render(<AdminSchedulesScreen />);
      await fireEvent.press(screen.getAllByText('Add Barber').at(-1)!);
      expect(screen.getByText('Barber name is required.')).toBeTruthy();
      expect(mockCreateMutate).not.toHaveBeenCalled();
    });

    it('creates the barber and reports it', async () => {
      mockCreateMutate.mockImplementation((_data, { onSuccess }) =>
        onSuccess({ id: 3, name: 'Jordan', email: 'j@example.com', phone: '1' }),
      );
      await render(<AdminSchedulesScreen />);
      await fireEvent.changeText(screen.getByLabelText('Name *'), ' Jordan ');
      await fireEvent.changeText(screen.getByLabelText('Email'), 'j@example.com');
      await fireEvent.press(screen.getAllByText('Add Barber').at(-1)!);

      expect(mockCreateMutate).toHaveBeenCalledWith(
        { name: 'Jordan', email: 'j@example.com', phone: '' },
        expect.anything(),
      );
      await waitFor(() => expect(screen.getByText('Barber Jordan added.')).toBeTruthy());
    });
  });
});
