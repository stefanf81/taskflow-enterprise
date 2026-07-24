import React from 'react';
import { render } from '@testing-library/react-native';
import { AdminCatalogScreen } from '../src/screens/AdminCatalogScreen';

jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: [
      { id: 1, name: 'Premium Haircut', price: 65, durationMinutes: 45, category: 'HAIRCUTS', description: 'Premium cut' },
      { id: 2, name: 'Royal Shave', price: 40, durationMinutes: 30, category: 'SHAVES', description: 'Royal treatment' },
    ],
    isLoading: false,
  }),
}));

describe('AdminCatalogScreen', () => {
  it('renders admin catalog title', async () => {
    const { getByText } = await render(<AdminCatalogScreen />);
    expect(getByText('Menu & Pricing')).toBeTruthy();
  });

  it('renders service names', async () => {
    const { getByText } = await render(<AdminCatalogScreen />);
    expect(getByText('Premium Haircut')).toBeTruthy();
    expect(getByText('Royal Shave')).toBeTruthy();
  });

  it('renders prices', async () => {
    const { getByText } = await render(<AdminCatalogScreen />);
    expect(getByText('$65.00')).toBeTruthy();
    expect(getByText('$40.00')).toBeTruthy();
  });

  it('renders SERVICE CATALOG badge', async () => {
    const { getByText } = await render(<AdminCatalogScreen />);
    expect(getByText('SERVICE CATALOG')).toBeTruthy();
  });
});
