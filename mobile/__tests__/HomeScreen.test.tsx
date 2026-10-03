import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/HomeScreen';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  CompositeNavigationProp: jest.fn(),
}));

// Controllable hook errors
let mockRatingsError: boolean;
let mockBarbersError: boolean;
let mockServicesError: boolean;
const mockRefetchBarbers = jest.fn();
const mockRefetchServices = jest.fn();

// Mock hooks
jest.mock('../src/hooks/useReviews', () => ({
  useBarberRatings: () => ({ data: [], isError: mockRatingsError }),
}));
jest.mock('../src/hooks/useBarbers', () => ({
  usePublicBarbers: () => ({
    data: [],
    isError: mockBarbersError,
    refetch: mockRefetchBarbers,
  }),
}));
jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: [],
    isError: mockServicesError,
    refetch: mockRefetchServices,
  }),
}));

// Mock auth store
jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: () => ({ isAuthenticated: false, role: null }),
}));

// Mock child components
jest.mock('../src/components/booking/StylistCard', () => ({
  StylistCard: () => <>{null}</>,
}));
jest.mock('../src/components/lookbook/LookbookGallery', () => ({
  LookbookGallery: () => <>{null}</>,
}));

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRatingsError = false;
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
});
