import React from 'react';
import { render } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/HomeScreen';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  CompositeNavigationProp: jest.fn(),
}));

// Mock hooks
jest.mock('../src/hooks/useReviews', () => ({
  useBarberRatings: () => ({ data: [] }),
}));
jest.mock('../src/hooks/useBarbers', () => ({
  useBarbers: () => ({ data: [] }),
}));
jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({ data: [] }),
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
});
