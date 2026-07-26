import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { BookingScreen } from '../src/screens/BookingScreen';

// ==================== Mock navigation ====================
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: {} }),
  useNavigation: () => ({ navigate: mockNavigate }),
  CompositeNavigationProp: jest.fn(),
}));

// ==================== Mock hooks — controllable ====================
// These `let` variables are initialized BEFORE the import statements
// (after jest.mock hoisting), so the module factory closures capture
// the live binding and read the current value on every hook call.
let mockMutateAsync: jest.Mock;
let mockBusySlotsData: string[];
let mockBusySlotsLoading: boolean;

jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: [
      { id: 1, name: 'Classic Haircut', price: 45, durationMinutes: 30, category: 'HAIRCUTS', description: 'A classic cut.' },
      { id: 2, name: 'Beard Trim', price: 25, durationMinutes: 20, category: 'BEARD_TRIM', description: 'Neat beard trim.' },
      { id: 3, name: 'Royal Shave', price: 35, durationMinutes: 25, category: 'SHAVES', description: 'Luxury shave.' },
    ],
  }),
}));

jest.mock('../src/hooks/useBarbers', () => ({
  useBarbers: () => ({ data: [{ id: 1, name: 'Alex the Barber', email: '', phone: '' }] }),
}));

jest.mock('../src/hooks/useAppointments', () => {
  const mutateAsync = jest.fn();
  mockMutateAsync = mutateAsync;
  return {
    useBusySlots: () => ({
      data: mockBusySlotsData ?? ['10:00'],
      isLoading: mockBusySlotsLoading ?? false,
    }),
    useCreateAppointment: () => ({
      mutateAsync,
      isPending: false,
    }),
  };
});

jest.mock('../src/components/booking/ReceiptModal', () => ({
  ReceiptModal: () => <>{null}</>,
}));

// ==================== Tests ====================
describe('BookingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBusySlotsData = ['10:00'];
    mockBusySlotsLoading = false;
    // Call methods on the EXISTING mockMutateAsync reference (created by
    // the factory) instead of reassigning the variable, which would not
    // affect the function reference captured by the component.
    mockMutateAsync.mockResolvedValue({
      id: 1, publicId: 'TF-NEW-001', customerName: 'John',
      customerEmail: 'j@ex.com', customerPhone: '+1',
      barberName: 'Alex', bookingDate: '2026-08-15',
      bookingTime: '09:00', serviceType: 'Classic Haircut',
      status: 'PENDING', createdAt: '', updatedAt: '',
    });
  });

  // ============ RENDERING ============
  it('renders header and step 1 initially', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('Booking Assistant')).toBeTruthy();
    expect(getByText('1. Select Treatment')).toBeTruthy();
  });

  it('renders all four timeline steps', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('1')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
  });

  it('lists available services on step 1', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('Classic Haircut')).toBeTruthy();
    expect(getByText('Beard Trim')).toBeTruthy();
    expect(getByText('Royal Shave')).toBeTruthy();
  });

  it('renders "Continue to Stylist" button on step 1', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('Continue to Stylist')).toBeTruthy();
  });

  // ============ STEP NAVIGATION ============
  it('navigates from step 1 to step 2 when Continue is pressed', async () => {
    const { getByText, queryByText, getAllByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    // Step 2 label appears in both header and step title -> 2 occurrences
    expect(getAllByText('2. Choose Your Stylist').length).toBe(2);
    expect(queryByText('Continue to Stylist')).toBeNull();
  });

  it('shows barber list on step 2', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    expect(getByText('No Preference (First Available)')).toBeTruthy();
    expect(getByText('Alex the Barber')).toBeTruthy();
  });

  it('shows Back and Continue buttons on step 2', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    expect(getByText('Back')).toBeTruthy();
    // "Continue" only appears once on step 2 (the button)
    expect(getByText('Continue')).toBeTruthy();
  });

  it('navigates from step 2 to step 3', async () => {
    const { getByText, getAllByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    expect(getAllByText('3. Pick Date & Available Slot').length).toBe(2);
  });

  it('navigates from step 3 to step 4', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));
    // Step 4 title is unique text (header says "4. Customer Info & Submit")
    expect(getByText('4. Contact Details & Summary')).toBeTruthy();
  });

  it('goes back from step 2 to step 1', async () => {
    const { getByText, queryByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Back'));
    expect(getByText('1. Select Treatment')).toBeTruthy();
  });

  it('goes back from step 3 to step 2', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Back'));
    expect(getByText('Select Barber')).toBeTruthy();
  });

  it('goes back from step 4 to step 3', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Back'));
    // Use unique step 3 label to avoid duplicate match
    expect(getByText('Select Operating Day')).toBeTruthy();
  });

  // ============ VALIDATION ============
  it('shows busy slot error on step 3 when time is busy', async () => {
    mockBusySlotsData = ['09:00']; // The default selected time is 09:00
    const { getByText, getAllByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    // Trying to continue with a busy slot should show an error
    await fireEvent.press(getByText('Continue'));
    expect(getByText(/already booked|choose another/i)).toBeTruthy();
    // Still on step 3
    expect(getAllByText('3. Pick Date & Available Slot').length).toBe(2);
  });

  it('shows validation error on missing contact fields in step 4', async () => {
    const { getByText, findByText } = await render(<BookingScreen />);
    // Navigate to step 4
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));
    await findByText('4. Contact Details & Summary');
    // Submit with empty fields
    await fireEvent.press(getByText('Confirm & Request Booking'));
    expect(getByText(/fill in all customer contact/i)).toBeTruthy();
  });

  // ============ FILTERS ============
  it('filters services by search query', async () => {
    const { getByText, queryByText, getByPlaceholderText } = await render(<BookingScreen />);
    expect(getByText('Beard Trim')).toBeTruthy();
    const searchInput = getByPlaceholderText(/search/i);
    await fireEvent.changeText(searchInput, 'shave');
    expect(queryByText('Classic Haircut')).toBeNull();
    expect(queryByText('Beard Trim')).toBeNull();
    expect(getByText('Royal Shave')).toBeTruthy();
  });

  it('filters services by category', async () => {
    const { getByText, queryByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('SHAVES'));
    expect(getByText('Royal Shave')).toBeTruthy();
    expect(queryByText('Classic Haircut')).toBeNull();
    expect(queryByText('Beard Trim')).toBeNull();
  });

  // ============ BUSY SLOTS INDICATOR ============
  it('shows loading indicator when checking slots', async () => {
    mockBusySlotsLoading = true;
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    expect(getByText('Checking slot availability...')).toBeTruthy();
  });

  // ============ SUBMIT ============
  it('submits booking successfully', async () => {
    const { getByText, getByPlaceholderText } = await render(<BookingScreen />);

    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));

    // Fill contact info
    await fireEvent.changeText(getByPlaceholderText(/john doe/i), 'John Smith');
    await fireEvent.changeText(getByPlaceholderText(/john\.doe/i), 'john@example.com');
    await fireEvent.changeText(getByPlaceholderText(/\+1 \(555\)/i), '+15551234567');

    await fireEvent.press(getByText('Confirm & Request Booking'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          customerName: 'John Smith',
          customerEmail: 'john@example.com',
          customerPhone: '+15551234567',
          serviceType: 'Classic Haircut',
          barberName: 'No Preference (First Available)',
        }),
      );
    });
  });

  it('shows error when booking submission fails', async () => {
    mockMutateAsync.mockRejectedValue({
      response: { data: { message: 'Time slot no longer available' } },
    });

    const { getByText, getByPlaceholderText, findByText } = await render(<BookingScreen />);

    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));

    await fireEvent.changeText(getByPlaceholderText(/john doe/i), 'Jane');
    await fireEvent.changeText(getByPlaceholderText(/john\.doe/i), 'jane@ex.com');
    await fireEvent.changeText(getByPlaceholderText(/\+1 \(555\)/i), '+1555000000');

    await fireEvent.press(getByText('Confirm & Request Booking'));

    expect(await findByText(/time slot no longer available/i)).toBeTruthy();
  });

  // ============ SUMMARY ============
  it('shows reservation summary with pricing on step 4', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));

    expect(getByText('Reservation Summary')).toBeTruthy();
    expect(getByText('$45.00')).toBeTruthy();  // subtotal
    expect(getByText('$2.50')).toBeTruthy();  // fee
    expect(getByText('$47.50')).toBeTruthy(); // total
  });
});
