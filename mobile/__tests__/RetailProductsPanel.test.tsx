import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { RetailProductsPanel } from '../src/features/admin/RetailProductsPanel';

type Product = { id: number; name: string; sizeLabel: string; price: number; sortOrder: number };
let mockProducts: Product[];
const mockSave = jest.fn();
const mockDelete = jest.fn();

jest.mock('../src/core/catalog/useRetailProducts', () => ({
  useRetailProducts: () => ({ data: mockProducts, isLoading: false, isError: false, refetch: jest.fn() }),
  useSaveRetailProduct: () => ({ mutate: mockSave, isPending: false }),
  useDeleteRetailProduct: () => ({ mutate: mockDelete, isPending: false }),
}));

const clay: Product = { id: 1, name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 24, sortOrder: 1 };

describe('RetailProductsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProducts = [clay];
  });

  it('lists the products with price and position', async () => {
    await render(<RetailProductsPanel />);
    expect(screen.getByText('Styling Fiber Clay (100ml)')).toBeTruthy();
    expect(screen.getByText('$24.00')).toBeTruthy();
    expect(screen.getByText('Position 1')).toBeTruthy();
  });

  it('adds a product after the last one, trimming an empty size away', async () => {
    await render(<RetailProductsPanel />);
    await fireEvent.press(screen.getByText('Add product'));
    expect(screen.getByDisplayValue('2')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'Matte Paste');
    await fireEvent.changeText(screen.getByLabelText('Size (optional)'), '  ');
    await fireEvent.changeText(screen.getByLabelText('Price'), '18,5');
    await fireEvent.press(screen.getByText('Save product'));

    expect(mockSave).toHaveBeenCalledWith(
      { id: null, request: { name: 'Matte Paste', price: 18.5, sortOrder: 2 } },
      expect.anything(),
    );
  });

  it('validates before saving', async () => {
    await render(<RetailProductsPanel />);
    await fireEvent.press(screen.getByText('Add product'));
    await fireEvent.changeText(screen.getByLabelText('Price'), '10');
    await fireEvent.press(screen.getByText('Save product'));

    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText('Product name is required')).toBeTruthy();
  });

  it('edits an existing product by id', async () => {
    await render(<RetailProductsPanel />);
    await fireEvent.press(screen.getByLabelText('Edit Styling Fiber Clay'));
    await fireEvent.changeText(screen.getByLabelText('Price'), '26');
    await fireEvent.press(screen.getByText('Save product'));

    expect(mockSave).toHaveBeenCalledWith(
      { id: 1, request: { name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 26, sortOrder: 1 } },
      expect.anything(),
    );
  });

  it('asks before deleting', async () => {
    await render(<RetailProductsPanel />);
    await fireEvent.press(screen.getByLabelText('Delete Styling Fiber Clay'));
    await fireEvent.press(screen.getByText('Keep'));
    expect(mockDelete).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Delete Styling Fiber Clay'));
    await fireEvent.press(screen.getByText('Delete Styling Fiber Clay?'));
    expect(mockDelete).toHaveBeenCalledWith(1, expect.anything());
  });

  it('shows an empty state when there are no products', async () => {
    mockProducts = [];
    await render(<RetailProductsPanel />);
    expect(screen.getByText('No Retail Products')).toBeTruthy();
  });
});
