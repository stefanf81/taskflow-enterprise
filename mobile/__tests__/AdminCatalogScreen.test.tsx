import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react-native';
import { AdminCatalogScreen } from '../src/features/admin/AdminCatalogScreen';

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
let mockRetired: typeof mockServices;
let mockRetiredEnabled: boolean | undefined;
const mockRestore = jest.fn();
let mockRestorePending = false;

jest.mock('../src/core/catalog/useCatalog', () => ({
  useCatalog: () => ({
    data: mockServices,
    isLoading: false,
    isError: mockIsError,
    refetch: mockRefetch,
  }),
  useRetiredServices: ({ enabled }: { enabled?: boolean } = {}) => {
    mockRetiredEnabled = enabled;
    return { data: mockRetired, isLoading: false, isError: false, refetch: mockRefetch };
  },
  useRestoreService: () => ({
    mutate: mockRestore,
    isPending: mockRestorePending,
    variables: undefined,
  }),
  useCreateService: () => ({
    mutate: jest.fn(),
    isPending: false,
    variables: undefined,
  }),
  useUpdateService: () => ({
    mutate: jest.fn(),
    isPending: false,
    variables: undefined,
  }),
  useRetireService: () => ({
    mutate: jest.fn(),
    isPending: false,
    variables: undefined,
  }),
}));

describe('AdminCatalogScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsError = false;
    mockRetired = [];
    mockRetiredEnabled = undefined;
    mockRestorePending = false;
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

  describe('retired services', () => {
    beforeEach(() => {
      mockRetired = [
        { id: 7, name: 'Old Fade', price: 30, durationMinutes: 25, category: 'hair', description: 'Retired cut' },
      ];
    });

    it('does not request the retired list until its tab is opened', async () => {
      await render(<AdminCatalogScreen />);
      expect(mockRetiredEnabled).toBe(false);
      expect(screen.queryByText('Old Fade')).toBeNull();

      await fireEvent.press(screen.getByText('Retired'));
      expect(mockRetiredEnabled).toBe(true);
      expect(screen.getByText('Old Fade')).toBeTruthy();
      // The active menu is not shown on the retired tab.
      expect(screen.queryByText('Premium Haircut')).toBeNull();
    });

    it('restores a retired service and confirms it', async () => {
      await render(<AdminCatalogScreen />);
      await fireEvent.press(screen.getByText('Retired'));
      await fireEvent.press(screen.getByText('Restore'));

      expect(mockRestore).toHaveBeenCalledTimes(1);
      expect(mockRestore.mock.calls[0][0]).toBe(7);
      const { onSuccess } = mockRestore.mock.calls[0][1];
      await act(async () => onSuccess());
      expect(screen.getByText('Old Fade is bookable again.')).toBeTruthy();
    });

    it('shows the failure when a restore is refused', async () => {
      await render(<AdminCatalogScreen />);
      await fireEvent.press(screen.getByText('Retired'));
      await fireEvent.press(screen.getByText('Restore'));

      const { onError } = mockRestore.mock.calls[0][1];
      await act(async () => onError(new Error('boom')));
      expect(screen.getByText(/Could not restore Old Fade|boom/)).toBeTruthy();
    });

    it('has no Restore button on the active tab and says so when nothing is retired', async () => {
      mockRetired = [];
      await render(<AdminCatalogScreen />);
      expect(screen.queryByText('Restore')).toBeNull();
      await fireEvent.press(screen.getByText('Retired'));
      expect(screen.getByText('No Retired Services')).toBeTruthy();
    });
  });
});
