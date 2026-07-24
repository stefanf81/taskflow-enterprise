import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BookingScreen } from '../src/screens/BookingScreen';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: {} }),
  useNavigation: () => ({ navigate: mockNavigate }),
  CompositeNavigationProp: jest.fn(),
}));

// Mock hooks
jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: [
      { id: 1, name: 'Classic Haircut', price: 45, durationMinutes: 30, category: 'HAIRCUTS', description: 'A classic cut.' },
      { id: 2, name: 'Beard Trim', price: 25, durationMinutes: 20, category: 'BEARD_TRIM', description: 'Neat beard trim.' },
    ],
  }),
}));

jest.mock('../src/hooks/useBarbers', () => ({
  useBarbers: () => ({ data: [{ id: 1, name: 'Alex the Barber', email: '', phone: '' }] }),
}));

jest.mock('../src/hooks/useAppointments', () => ({
  useBusySlots: () => ({ data: ['10:00'], isLoading: false }),
  useCreateAppointment: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}));

// Mock child components
jest.mock('../src/components/booking/ReceiptModal', () => ({
  ReceiptModal: () => <>{null}</>,
}));

describe('BookingScreen', () => {
  it('renders booking wizard header', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('Booking Assistant')).toBeTruthy();
  });

  it('renders step 1 with service selection', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('1. Select Service & Barber')).toBeTruthy();
  });

  it('renders step timeline', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('1')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });
});
