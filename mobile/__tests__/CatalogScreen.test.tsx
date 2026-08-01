import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  CompositeNavigationProp: jest.fn(),
}));

jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: [
      { id: 1, name: 'Classic Haircut', price: 45, durationMinutes: 30, category: 'hair', description: 'Classic' },
      { id: 2, name: 'Luxury Shave', price: 35, durationMinutes: 45, category: 'beard', description: 'Premium' },
      { id: 3, name: 'Gold Combo', price: 90, durationMinutes: 75, category: 'combo', description: 'Full package' },
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
    expect(screen.getByText('Gold Combo')).toBeTruthy();
  });

  it('renders prices', async () => {
    await render(<CatalogScreen />);
    expect(screen.getByText('$45.00')).toBeTruthy();
    expect(screen.getByText('$35.00')).toBeTruthy();
    expect(screen.getByText('$90.00')).toBeTruthy();
  });

  it('renders category filter chips from backend category values', async () => {
    await render(<CatalogScreen />);
    expect(screen.getByText('All Services')).toBeTruthy();
    // 'Haircuts' appears as a chip AND as the Classic Haircut badge
    expect(screen.getAllByText('Haircuts').length).toBeGreaterThanOrEqual(1);
    // 'Beards & Shaves' appears as a chip AND as the Luxury Shave badge
    expect(screen.getAllByText('Beards & Shaves').length).toBeGreaterThanOrEqual(1);
    // 'Combos' appears as a chip AND as the Gold Combo badge
    expect(screen.getAllByText('Combos').length).toBeGreaterThanOrEqual(1);
  });

  it('filters services by category', async () => {
    await render(<CatalogScreen />);
    // [0] is the filter chip (rendered before the list); badges share the label
    await fireEvent.press(screen.getAllByText('Haircuts')[0]);
    expect(screen.getByText('Classic Haircut')).toBeTruthy();
    expect(screen.queryByText('Luxury Shave')).toBeNull();
    expect(screen.queryByText('Gold Combo')).toBeNull();

    await fireEvent.press(screen.getAllByText('Beards & Shaves')[0]);
    expect(screen.getByText('Luxury Shave')).toBeTruthy();
    expect(screen.queryByText('Classic Haircut')).toBeNull();

    await fireEvent.press(screen.getAllByText('Combos')[0]);
    expect(screen.getByText('Gold Combo')).toBeTruthy();
    expect(screen.queryByText('Luxury Shave')).toBeNull();
  });
});
