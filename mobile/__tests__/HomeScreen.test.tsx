import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { HomeScreen } from '../src/features/landing/HomeScreen';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => true,
  CompositeNavigationProp: jest.fn(),
}));

// Controllable hook errors
let mockRatingsError: boolean;
let mockRatings: { barberName: string; averageRating: number; reviewCount: number }[];
let mockProducts: { id: number; name: string; sizeLabel: string; price: number; sortOrder: number }[];
let mockProductsError: boolean;
const mockRefetchProducts = jest.fn();
let mockBarbersError: boolean;
let mockServicesError: boolean;
const mockRefetchBarbers = jest.fn();
const mockRefetchServices = jest.fn();

// Mock hooks
// The shop info (time zone, window, hours) as the server's defaults: no query client needed.
jest.mock('../src/core/shop/useShopInfo', () => ({
  useShopInfo: () => ({
    timeZone: null,
    rules: jest.requireActual('@taskflow/domain').DEFAULT_SHOP_RULES,
    loaded: false,
  }),
}));

jest.mock('../src/features/landing/useReviews', () => ({
  useBarberRatings: () => ({ data: mockRatings, isLoading: false, isError: mockRatingsError }),
}));
jest.mock('../src/core/catalog/useRetailProducts', () => ({
  useRetailProducts: () => ({
    data: mockProducts,
    isLoading: false,
    isError: mockProductsError,
    refetch: mockRefetchProducts,
  }),
}));
jest.mock('../src/core/barbers/useBarbers', () => ({
  usePublicBarbers: () => ({
    data: [],
    isError: mockBarbersError,
    refetch: mockRefetchBarbers,
  }),
}));
jest.mock('../src/core/catalog/useCatalog', () => ({
  useCatalog: () => ({
    data: [],
    isError: mockServicesError,
    refetch: mockRefetchServices,
  }),
}));

// Mock auth store
jest.mock('../src/core/auth/useAuthStore', () => ({
  useAuthStore: () => ({ isAuthenticated: false, role: null }),
}));

// Mock child components
jest.mock('../src/features/booking/StylistCard', () => ({
  StylistCard: () => <>{null}</>,
}));
jest.mock('../src/features/landing/LookbookGallery', () => ({
  LookbookGallery: () => <>{null}</>,
}));

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRatingsError = false;
    mockRatings = [];
    mockProducts = [];
    mockProductsError = false;
    mockBarbersError = false;
    mockServicesError = false;
  });

  it('renders hero section title', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText(/Luxury Barber/)).toBeTruthy();
  });

  it('renders announcement bar', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText(/Special Highlight/)).toBeTruthy();
  });

  it('renders FAQ section', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Frequently Asked Questions')).toBeTruthy();
  });

  it('renders sign-in button for unauthenticated users', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Sign In / Register')).toBeTruthy();
  });

  it('offers guest booking management on Home', async () => {
    const { getByText } = await render(<HomeScreen />);
    await fireEvent.press(getByText('Manage Booking'));
    expect(mockNavigate).toHaveBeenCalledWith('PublicActions', {});
  });

  it('renders Master Stylists section', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Master Stylists')).toBeTruthy();
  });

  it('renders security footer', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText(/100% secured/)).toBeTruthy();
  });

  it('shows section-level errors without blanking the page and retries each section', async () => {
    mockRatingsError = true;
    mockBarbersError = true;
    mockServicesError = true;
    const { getByText, getAllByText } = await render(<HomeScreen />);

    // Hero/FAQ/lookbook stay intact
    expect(getByText(/Luxury Barber/)).toBeTruthy();
    expect(getByText('Frequently Asked Questions')).toBeTruthy();

    // Section bodies are replaced by error states
    expect(getByText("Couldn't load the grooming menu.")).toBeTruthy();
    expect(getByText("Couldn't load the stylist roster.")).toBeTruthy();
    expect(screen.queryByText('No Services Found')).toBeNull();

    const retryButtons = getAllByText('Retry');
    expect(retryButtons.length).toBe(2);
    await fireEvent.press(retryButtons[0]);
    await fireEvent.press(retryButtons[1]);
    expect(mockRefetchServices).toHaveBeenCalledTimes(1);
    expect(mockRefetchBarbers).toHaveBeenCalledTimes(1);
  });

  it('opens the sign-in screen from the header\'s "Sign in" (customers and the owner)', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(screen.queryByText('Owner Portal')).toBeNull();
    await fireEvent.press(getByText('Sign in'));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });

  it('shows the real shop rating instead of a hand-picked quote', async () => {
    mockRatings = [
      { barberName: 'Alex the Barber', averageRating: 4.5, reviewCount: 10 },
      { barberName: 'Sara the Stylist', averageRating: 5, reviewCount: 30 },
    ];
    const { getByText, getByLabelText } = await render(<HomeScreen />);
    expect(getByLabelText('4.9 out of 5 from 40 reviews')).toBeTruthy();
    expect(getByText('Sara the Stylist')).toBeTruthy();
    expect(screen.queryByText(/Liam K\./)).toBeNull();
  });

  it('says so when nobody has been reviewed yet, or the ratings failed', async () => {
    const { getByText, unmount } = await render(<HomeScreen />);
    expect(getByText(/No reviews yet/)).toBeTruthy();
    await unmount();

    mockRatingsError = true;
    await render(<HomeScreen />);
    expect(screen.getByText('Ratings are unavailable right now.')).toBeTruthy();
  });

  it('lists the retail products from the backend, in its order', async () => {
    mockProducts = [
      { id: 1, name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 24, sortOrder: 1 },
      { id: 2, name: 'Comb', sizeLabel: '', price: 5, sortOrder: 2 },
    ];
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Styling Fiber Clay (100ml)')).toBeTruthy();
    expect(getByText('$24.00')).toBeTruthy();
    expect(getByText('Comb')).toBeTruthy();
    expect(getByText('$5.00')).toBeTruthy();
  });

  it('says so when no products are listed, and retries a failed load', async () => {
    const { getByText, unmount } = await render(<HomeScreen />);
    expect(getByText("Ask in the shop about today's products.")).toBeTruthy();
    await unmount();

    mockProductsError = true;
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByText('Could not load the products. Tap to retry.'));
    expect(mockRefetchProducts).toHaveBeenCalledTimes(1);
  });
});
