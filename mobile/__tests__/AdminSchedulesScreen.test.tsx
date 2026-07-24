import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AdminSchedulesScreen } from '../src/screens/AdminSchedulesScreen';

const mockMutateAsync = jest.fn();
jest.mock('../src/hooks/useBarbers', () => ({
  useBarbers: () => ({
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
}));

describe('AdminSchedulesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders schedules title', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('Barber Time-Off')).toBeTruthy();
  });

  it('renders barber selection chips', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('Alex the Barber')).toBeTruthy();
    expect(getByText('Sara the Stylist')).toBeTruthy();
  });

  it('renders time-off records', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('2026-08-01 → 2026-08-03')).toBeTruthy();
    expect(getByText('Reason: Vacation')).toBeTruthy();
  });

  it('renders add time-off form', async () => {
    const { getByText } = await render(<AdminSchedulesScreen />);
    expect(getByText('Schedule New Time-Off')).toBeTruthy();
    expect(getByText('Add Time-Off Record')).toBeTruthy();
  });
});
