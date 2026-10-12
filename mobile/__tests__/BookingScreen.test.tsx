import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import {
  BookingScreen,
  getPostBookingDestination,
  NO_PREFERENCE_BARBER,
} from '../src/screens/BookingScreen';
import { freezeDate, moveClockTo, restoreClock } from '../test/fakeClock';

// ==================== Mock navigation ====================
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockSetParams = jest.fn();
let mockRouteNames: string[];
let mockRouteParams: Record<string, string | undefined> | undefined;
let mockNavListeners: Record<string, Array<() => void>>;
// A stable navigation object, like the real one (effects depend on it).
const mockNavigation = {
  navigate: (...args: unknown[]) => mockNavigate(...args),
  dispatch: (...args: unknown[]) => mockDispatch(...args),
  setParams: (...args: unknown[]) => mockSetParams(...args),
  getState: () => ({ routes: mockRouteNames.map((name) => ({ name })) }),
  addListener: (event: string, cb: () => void) => {
    (mockNavListeners[event] ??= []).push(cb);
    return () => {
      mockNavListeners[event] = (mockNavListeners[event] ?? []).filter((l) => l !== cb);
    };
  },
};
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockRouteParams }),
  useNavigation: () => mockNavigation,
  CommonActions: {
    navigate: (payload: unknown) => ({ type: 'NAVIGATE', payload }),
  },
  CompositeNavigationProp: jest.fn(),
}));

// ==================== Mock hooks — controllable ====================
// These `let` variables are initialized BEFORE the import statements
// (after jest.mock hoisting), so the module factory closures capture
// the live binding and read the current value on every hook call.
let mockMutateAsync: jest.Mock;
let mockUseBusySlots: jest.Mock;
let mockBusySlotsData: string[];
let mockBusySlotsLoading: boolean;
let mockBusySlotsError: unknown;
let mockCatalogData: any[] | null;

// Backend category values (V5__create_service_catalog.sql): hair | beard | combo
const DEFAULT_CATALOG = [
  { id: 1, name: 'Classic Haircut', price: 45, durationMinutes: 30, category: 'hair', description: 'A classic cut.' },
  { id: 2, name: 'Beard Trim', price: 25, durationMinutes: 20, category: 'beard', description: 'Neat beard trim.' },
  { id: 3, name: 'Royal Shave', price: 35, durationMinutes: 25, category: 'beard', description: 'Luxury shave.' },
  { id: 4, name: 'The Executive Package', price: 80, durationMinutes: 60, category: 'combo', description: 'Haircut + beard + shave.' },
];

jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: mockCatalogData ?? DEFAULT_CATALOG,
  }),
}));

jest.mock('../src/hooks/useBarbers', () => ({
  usePublicBarbers: () => ({ data: [{ id: 1, name: 'Alex the Barber' }] }),
}));

const mockRefetchBusySlots = jest.fn();
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `123e4567-e89b-12d3-a456-42661417${String(++mockUuidCounter).padStart(4, '0')}`),
}));

jest.mock('../src/hooks/useAppointments', () => {
  const mutateAsync = jest.fn();
  mockMutateAsync = mutateAsync;
  return {
    useBusySlots: (...args: unknown[]) => {
      mockUseBusySlots(...args);
      return {
        data: mockBusySlotsData ?? ['10:00'],
        isLoading: mockBusySlotsLoading ?? false,
        isError: !!mockBusySlotsError,
        error: mockBusySlotsError,
        refetch: mockRefetchBusySlots,
      };
    },
    useCreateAppointment: () => ({
      mutateAsync,
      isPending: false,
    }),
  };
});

// Capture the props the screen passes to ReceiptModal so tests can drive
// the onClose callback (receipt → post-booking navigation).
let mockReceiptProps: {
  appointment: unknown;
  onClose: () => void;
  onOpenPublicActions: (publicId: string) => void;
} | null = null;

jest.mock('../src/components/booking/ReceiptModal', () => ({
  ReceiptModal: (props: any) => {
    mockReceiptProps = props;
    return <>{null}</>;
  },
}));

// ==================== Tests ====================
describe('BookingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Wednesday 2026-08-12 08:00 local: every DEFAULT_TIME_SLOTS entry is still
    // in the future, so the legacy tests below behave exactly as before.
    freezeDate('2026-08-12T08:00:00');
    mockUseBusySlots = jest.fn();
    mockRouteParams = {};
    mockNavListeners = {};
    mockBusySlotsError = undefined;
    mockUuidCounter = 0;
    mockBusySlotsData = ['10:00'];
    mockBusySlotsLoading = false;
    mockCatalogData = null;
    mockRouteNames = ['Home', 'Booking', 'Catalog', 'Lookbook'];
    mockReceiptProps = null;
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

  afterEach(() => {
    restoreClock();
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

  it('filters services by category chip (backend category values)', async () => {
    const { getByText, queryByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Beards & Shaves'));
    expect(getByText('Beard Trim')).toBeTruthy();
    expect(getByText('Royal Shave')).toBeTruthy();
    expect(queryByText('Classic Haircut')).toBeNull();
    expect(queryByText('The Executive Package')).toBeNull();
  });

  it('filters services by combo category chip', async () => {
    const { getByText, queryByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Combos'));
    expect(getByText('The Executive Package')).toBeTruthy();
    expect(queryByText('Classic Haircut')).toBeNull();
    expect(queryByText('Beard Trim')).toBeNull();
  });

  it('filters services by haircut category chip', async () => {
    const { getByText, queryByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Haircuts'));
    expect(getByText('Classic Haircut')).toBeTruthy();
    expect(queryByText('Beard Trim')).toBeNull();
    expect(queryByText('Royal Shave')).toBeNull();
  });

  it('shows all services on the default All chip', async () => {
    const { getByText } = await render(<BookingScreen />);
    expect(getByText('Classic Haircut')).toBeTruthy();
    expect(getByText('The Executive Package')).toBeTruthy();
  });

  it('falls back to the first catalog service when the hardcoded default is absent', async () => {
    mockCatalogData = [
      { id: 9, name: 'Signature Cut', price: 50, durationMinutes: 30, category: 'hair', description: 'Tailored.' },
    ];
    const { getByText, findByText } = await render(<BookingScreen />);
    // Navigate to step 4 — the summary must show the auto-selected service
    // (previously it stayed on 'Classic Haircut' and priced $0.00)
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));
    await findByText('4. Contact Details & Summary');
    expect(getByText('Signature Cut')).toBeTruthy();
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
          data: expect.objectContaining({
            customerName: 'John Smith',
            customerEmail: 'john@example.com',
            customerPhone: '+15551234567',
            serviceType: 'Classic Haircut',
            barberName: 'No Preference (First Available)',
          }),
          idempotencyKey: expect.any(String),
        }),
      );
    });
  });

  it('reuses the Idempotency-Key across an identical retry and rotates after success', async () => {
    mockMutateAsync
      .mockRejectedValueOnce({ response: { data: { message: 'Timed out' } } })
      .mockResolvedValueOnce({ id: 1, publicId: 'pub-1' });

    const { getByText, getByPlaceholderText } = await render(<BookingScreen />);

    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));
    await fireEvent.changeText(getByPlaceholderText(/john doe/i), 'John Smith');
    await fireEvent.changeText(getByPlaceholderText(/john\.doe/i), 'john@example.com');
    await fireEvent.changeText(getByPlaceholderText(/\+1 \(555\)/i), '+15551234567');

    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));

    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));

    const first = mockMutateAsync.mock.calls[0][0];
    const retry = mockMutateAsync.mock.calls[1][0];
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
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

  // ============ POST-BOOKING RECEIPT NAVIGATION ============
  const submitValidBooking = async (getByText: any, getByPlaceholderText: any) => {
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));
    await fireEvent.changeText(getByPlaceholderText(/john doe/i), 'John Smith');
    await fireEvent.changeText(getByPlaceholderText(/john\.doe/i), 'john@example.com');
    await fireEvent.changeText(getByPlaceholderText(/\+1 \(555\)/i), '+15551234567');
    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockReceiptProps?.appointment).toBeTruthy());
  };

  it('navigates to Home after booking in the guest flow', async () => {
    mockRouteNames = ['Home', 'Booking', 'Catalog', 'Lookbook'];
    const { getByText, getByPlaceholderText } = await render(<BookingScreen />);
    await submitValidBooking(getByText, getByPlaceholderText);
    await act(async () => {
      mockReceiptProps?.onClose();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { name: 'Home' } }),
    );
  });

  it('navigates to CustomerAppointments after booking in the customer flow', async () => {
    // Customer tab navigator has no 'Home' route — navigating there would
    // crash with "action NAVIGATE with name Home was not handled".
    mockRouteNames = ['CustomerAppointments', 'NewBooking', 'CustomerCatalog'];
    const { getByText, getByPlaceholderText } = await render(<BookingScreen />);
    await submitValidBooking(getByText, getByPlaceholderText);
    await act(async () => {
      mockReceiptProps?.onClose();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { name: 'CustomerAppointments' } }),
    );
  });

  // ============ SUMMARY ============
  it('shows reservation summary with pricing on step 4', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    mockBusySlotsData = [];
    await fireEvent.press(getByText('Continue'));

    expect(getByText('Reservation Summary')).toBeTruthy();
    // No platform fee is modelled server-side: the total is the service price.
    expect(getByText('$45.00')).toBeTruthy();
  });
});

// ==================== Wizard behaviour (MOB-2/3/4) ====================
/** Capture AppState 'change' listeners so a test can fire a foreground tick. */
const captureAppStateHandlers = () => {
  const handlers: Array<(state: string) => void> = [];
  const original = (AppState.addEventListener as jest.Mock).getMockImplementation();
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_event: string, handler: (state: string) => void) => {
      handlers.push(handler);
      return { remove: jest.fn() };
    },
  );
  return {
    handlers,
    restore: () => (AppState.addEventListener as jest.Mock).mockImplementation(original),
  };
};

describe('BookingScreen wizard behaviour', () => {
  const fill = async (getByPlaceholderText: any) => {
    await fireEvent.changeText(getByPlaceholderText(/john doe/i), 'John Smith');
    await fireEvent.changeText(getByPlaceholderText(/john\.doe/i), 'john@example.com');
    await fireEvent.changeText(getByPlaceholderText(/\+1 \(555\)/i), '+15551234567');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    freezeDate('2026-08-12T08:00:00');
    mockUseBusySlots = jest.fn();
    mockRouteParams = {};
    mockNavListeners = {};
    mockBusySlotsError = undefined;
    mockUuidCounter = 0;
    mockBusySlotsData = [];
    mockBusySlotsLoading = false;
    mockCatalogData = null;
    mockRouteNames = ['Home', 'Booking', 'Catalog', 'Lookbook'];
    mockReceiptProps = null;
    mockMutateAsync.mockResolvedValue({
      id: 1, publicId: 'pub-1', customerName: 'John', customerEmail: 'j@ex.com',
      customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-12',
      bookingTime: '09:00', serviceType: 'Classic Haircut', status: 'PENDING',
      createdAt: '', updatedAt: '',
    });
  });

  afterEach(() => {
    restoreClock();
  });

  // ---- MOB-3 ----
  it('passes the No Preference sentinel through to the busy-slots query', async () => {
    await render(<BookingScreen />);
    // Before: effectiveBarber was '' which disabled the query and showed every slot free.
    expect(mockUseBusySlots).toHaveBeenCalledWith(NO_PREFERENCE_BARBER, '2026-08-12');
    expect(mockUseBusySlots).not.toHaveBeenCalledWith('', expect.anything());
  });

  it('queries the chosen barber once one is selected', async () => {
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Alex the Barber'));
    expect(mockUseBusySlots).toHaveBeenLastCalledWith('Alex the Barber', '2026-08-12');
  });

  it('shows the server message and a retry when busy slots cannot be loaded', async () => {
    mockBusySlotsError = { response: { status: 400, data: { message: 'Unknown barber' } } };
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    expect(getByText('Unknown barber')).toBeTruthy();
    await fireEvent.press(getByText('Retry'));
    expect(mockRefetchBusySlots).toHaveBeenCalled();
    await fireEvent.press(getByText('Continue'));
    expect(getByText('Unknown barber')).toBeTruthy();
  });

  it('explains a 503 busy-slots failure when the body has no message', async () => {
    mockBusySlotsError = { response: { status: 503, data: {} } };
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    expect(getByText(/temporarily unavailable/i)).toBeTruthy();
  });

  // ---- MOB-4 ----
  it('disables slots that already passed today and defaults to the first future slot', async () => {
    moveClockTo('2026-08-12T12:30:00');
    const { getByText, getAllByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    // 09:00, 10:00 and 11:00 are past.
    expect(getAllByText('Passed').length).toBe(3);
    await fireEvent.press(getByText('09:00'));
    await fireEvent.press(getByText('Continue'));
    // The default (13:00) is selectable: Continue advances to step 4.
    expect(getByText('4. Contact Details & Summary')).toBeTruthy();
    expect(getByText(/2026-08-12 @ 1:00 PM/)).toBeTruthy();
  });

  it('defaults to the next bookable day when no slot is left today', async () => {
    moveClockTo('2026-08-12T18:00:00');
    await render(<BookingScreen />);
    expect(mockUseBusySlots).toHaveBeenCalledWith(NO_PREFERENCE_BARBER, '2026-08-13');
  });

  it('skips Sunday when it is the next bookable day', async () => {
    moveClockTo('2026-08-15T18:00:00'); // Saturday evening
    await render(<BookingScreen />);
    expect(mockUseBusySlots).toHaveBeenCalledWith(NO_PREFERENCE_BARBER, '2026-08-17');
  });

  it('re-validates the selection when the day rolls over', async () => {
    moveClockTo('2026-08-12T23:30:00');
    const { handlers, restore } = captureAppStateHandlers();
    try {
      await render(<BookingScreen />);
      expect(mockUseBusySlots).toHaveBeenLastCalledWith(NO_PREFERENCE_BARBER, '2026-08-13');

      moveClockTo('2026-08-13T00:05:00');
      mockUseBusySlots.mockClear();
      await act(async () => {
        handlers.forEach((h) => h('active'));
      });
      // Day list re-based on the new date; the previous (now past) date is gone.
      expect(mockUseBusySlots).toHaveBeenLastCalledWith(NO_PREFERENCE_BARBER, '2026-08-13');
    } finally {
      restore();
    }
  });

  it('moves a selection whose slot just passed to the next future slot', async () => {
    const { handlers, restore } = captureAppStateHandlers();
    try {
      const { getByText } = await render(<BookingScreen />);
      await fireEvent.press(getByText('Continue to Stylist'));
      await fireEvent.press(getByText('Continue'));
      // 09:00 is selected; the clock passes it.
      moveClockTo('2026-08-12T09:30:00');
      await act(async () => {
        handlers.forEach((h) => h('active'));
      });
      await fireEvent.press(getByText('Continue'));
      expect(getByText(/2026-08-12 @ 10:00 AM/)).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('refuses Continue when the selected slot passed since it was chosen', async () => {
    const { getByText, getAllByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    // The clock moves without a re-render tick: handleNextStep must still check.
    moveClockTo('2026-08-12T09:30:00');
    await fireEvent.press(getByText('Continue'));
    expect(getByText(/already passed/i)).toBeTruthy();
    expect(getAllByText('3. Pick Date & Available Slot').length).toBe(2);
  });

  it('sends the user back to date selection when the slot passes during contact entry', async () => {
    const { getByText, getByPlaceholderText, getAllByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    await fill(getByPlaceholderText);
    moveClockTo('2026-08-12T09:30:00');
    await fireEvent.press(getByText('Confirm & Request Booking'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(getByText(/already passed/i)).toBeTruthy();
    expect(getAllByText('3. Pick Date & Available Slot').length).toBe(2);
  });

  // ---- MOB-2 ----
  it('resets the whole wizard after a successful booking and rotates the idempotency key', async () => {
    const { getByText, getByPlaceholderText, queryByDisplayValue } = await render(<BookingScreen />);

    const book = async () => {
      await fireEvent.press(getByText('Continue to Stylist'));
      await fireEvent.press(getByText('Alex the Barber'));
      await fireEvent.press(getByText('Continue'));
      await fireEvent.press(getByText('Continue'));
      await fill(getByPlaceholderText);
      await fireEvent.press(getByText('Confirm & Request Booking'));
      await waitFor(() => expect(mockReceiptProps?.appointment).toBeTruthy());
    };

    await book();
    // Wizard is back at step 1 with default selections and no leftover contact data.
    expect(getByText('1. Select Treatment')).toBeTruthy();
    await act(async () => {
      mockReceiptProps?.onClose();
    });
    await fireEvent.press(getByText('Continue to Stylist'));
    expect(mockUseBusySlots).toHaveBeenLastCalledWith(NO_PREFERENCE_BARBER, '2026-08-12');
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    expect(queryByDisplayValue('John Smith')).toBeNull();
    expect(queryByDisplayValue('john@example.com')).toBeNull();

    // Second booking: a NEW idempotency key.
    await fill(getByPlaceholderText);
    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    const [first, second] = mockMutateAsync.mock.calls.map((c) => c[0]);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(first.data.barberName).toBe('Alex the Barber');
    expect(second.data.barberName).toBe(NO_PREFERENCE_BARBER);
  });

  it('keeps the receipt total after the wizard reset', async () => {
    const { getByText, getByPlaceholderText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Royal Shave'));
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    await fill(getByPlaceholderText);
    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockReceiptProps?.appointment).toBeTruthy());
    expect((mockReceiptProps as any).checkoutTotal).toBe(35);
  });

  it('keeps the same idempotency key for an identical retry after a failure', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network Error'));
    const { getByText, getByPlaceholderText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    await fill(getByPlaceholderText);
    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockMutateAsync.mock.calls[1][0].idempotencyKey).toBe(
      mockMutateAsync.mock.calls[0][0].idempotencyKey,
    );
  });

  it('rotates the idempotency key after a 409 conflict', async () => {
    mockMutateAsync.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'Idempotency key reused' } },
    });
    const { getByText, getByPlaceholderText, findByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    await fill(getByPlaceholderText);
    await fireEvent.press(getByText('Confirm & Request Booking'));
    expect(await findByText('Idempotency key reused')).toBeTruthy();
    await fireEvent.press(getByText('Confirm & Request Booking'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockMutateAsync.mock.calls[1][0].idempotencyKey).not.toBe(
      mockMutateAsync.mock.calls[0][0].idempotencyKey,
    );
  });

  it('surfaces server booking-rule messages (e.g. max active bookings)', async () => {
    mockMutateAsync.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'You already have 5 active bookings' } },
    });
    const { getByText, getByPlaceholderText, findByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    await fill(getByPlaceholderText);
    await fireEvent.press(getByText('Confirm & Request Booking'));
    expect(await findByText('You already have 5 active bookings')).toBeTruthy();
  });

  it('discards in-progress wizard state when the tab loses focus', async () => {
    const { getByText, getByPlaceholderText, queryByDisplayValue, getAllByText } = await render(
      <BookingScreen />,
    );
    await fireEvent.press(getByText('Royal Shave'));
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Alex the Barber'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    await fill(getByPlaceholderText);

    await act(async () => {
      (mockNavListeners.blur ?? []).forEach((l) => l());
    });

    expect(getByText('1. Select Treatment')).toBeTruthy();
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    expect(queryByDisplayValue('John Smith')).toBeNull();
    // Back to the defaults: Classic Haircut / No Preference.
    expect(getAllByText('Classic Haircut').length).toBeGreaterThan(0);
    expect(getAllByText(NO_PREFERENCE_BARBER).length).toBeGreaterThan(0);
  });

  it('applies new route params on re-navigation and consumes them', async () => {
    mockRouteParams = { preselectedService: 'Royal Shave' };
    const { getByText, rerender } = await render(<BookingScreen />);
    expect(mockSetParams).toHaveBeenCalledWith({
      preselectedBarber: undefined,
      preselectedService: undefined,
    });
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    expect(getByText('Royal Shave')).toBeTruthy(); // summary treatment

    // The tab stays mounted; the user re-navigates with different params.
    await act(async () => {
      (mockNavListeners.blur ?? []).forEach((l) => l());
    });
    mockRouteParams = { preselectedService: 'Beard Trim', preselectedBarber: 'Alex the Barber' };
    await rerender(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    expect(getByText('Beard Trim')).toBeTruthy();
    expect(getByText('Alex the Barber')).toBeTruthy();
  });

  it('ignores a preselected service that is not in the catalog', async () => {
    mockRouteParams = { preselectedService: 'Does Not Exist' };
    const { getByText } = await render(<BookingScreen />);
    await fireEvent.press(getByText('Continue to Stylist'));
    await fireEvent.press(getByText('Continue'));
    await fireEvent.press(getByText('Continue'));
    expect(getByText('Classic Haircut')).toBeTruthy();
  });
});

// ==================== getPostBookingDestination (pure helper) ====================
describe('getPostBookingDestination', () => {
  it('returns Home when the Home route exists (guest flow)', () => {
    expect(
      getPostBookingDestination(['Home', 'Booking', 'Catalog', 'Lookbook']),
    ).toBe('Home');
  });

  it('returns CustomerAppointments when Home is absent (customer flow)', () => {
    expect(
      getPostBookingDestination(['CustomerAppointments', 'NewBooking', 'CustomerCatalog']),
    ).toBe('CustomerAppointments');
  });

  it('returns CustomerAppointments for an empty route list', () => {
    expect(getPostBookingDestination([])).toBe('CustomerAppointments');
  });
});
