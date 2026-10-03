import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { AdminCatalogScreen } from '../src/screens/AdminCatalogScreen';

let mockIsError: boolean;
let mockServices: Array<{
  id: number;
  name: string;
  price: number;
  durationMinutes: number;
  category: string;
  description: string;
}>;
const mockRefetch = jest.fn();

jest.mock('../src/hooks/useCatalog', () => ({
  useCatalog: () => ({
    data: mockServices,
    isLoading: false,
    isError: mockIsError,
    refetch: mockRefetch,
  }),
}));

describe('AdminCatalogScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsError = false;
    mockServices = [
      { id: 1, name: 'Premium Haircut', price: 65, durationMinutes: 45, category: 'hair', description: 'Premium cut' },
      { id: 2, name: 'Royal Shave', price: 40, durationMinutes: 30, category: 'beard', description: 'Royal treatment' },
    ];
  });

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

  it('shows empty state when the catalog is truly empty', async () => {
    mockServices = [];
    await render(<AdminCatalogScreen />);
    expect(screen.getByText('No Services Found')).toBeTruthy();
    expect(screen.getByText('The service catalog is currently empty.')).toBeTruthy();
  });

  it('shows error state and retries when the catalog fails to load', async () => {
    mockIsError = true;
    await render(<AdminCatalogScreen />);
    expect(screen.getByText("Couldn't load the service catalog.")).toBeTruthy();
    expect(screen.queryByText('No Services Found')).toBeNull();
    await fireEvent.press(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
