import React from 'react';
import { render, screen } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  CompositeNavigationProp: jest.fn(),
}));

jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: [
      { id: 1, name: 'Classic Haircut', price: 45, durationMinutes: 30, category: 'HAIRCUTS', description: 'Classic' },
      { id: 2, name: 'Luxury Shave', price: 35, durationMinutes: 45, category: 'SHAVES', description: 'Premium' },
    ],
    isLoading: false,
  }),
}));

import { CatalogScreen } from '../src/screens/CatalogScreen';

describe('CatalogScreen', () => {
  it('renders catalog title', async () => {
    await render(<CatalogScreen />);
    expect(screen.getByText('Service Catalog')).toBeTruthy();
  });

  it('renders service items', async () => {
    await render(<CatalogScreen />);
    expect(screen.getByText('Classic Haircut')).toBeTruthy();
    expect(screen.getByText('Luxury Shave')).toBeTruthy();
  });

  it('renders prices', async () => {
    await render(<CatalogScreen />);
    expect(screen.getByText('$45.00')).toBeTruthy();
    expect(screen.getByText('$35.00')).toBeTruthy();
  });

  it('renders category filter chips', async () => {
    await render(<CatalogScreen />);
    expect(screen.getByText('All Services')).toBeTruthy();
    // HAIRCUTS appears both as a category chip AND in the service badge
    const haircuts = screen.getAllByText('HAIRCUTS');
    expect(haircuts.length).toBeGreaterThanOrEqual(1);
  });
});
