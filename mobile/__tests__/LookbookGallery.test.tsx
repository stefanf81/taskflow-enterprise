import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { LookbookGallery } from '../src/components/lookbook/LookbookGallery';

describe('LookbookGallery Component', () => {
  it('renders all lookbook items', async () => {
    await render(<LookbookGallery />);
    expect(screen.getByText('Executive Pompadour & Beard Trim')).toBeTruthy();
    expect(screen.getByText('Zero Skin Fade & Textured Crop')).toBeTruthy();
    expect(screen.getByText('Hot Towel Royal Razor Shave')).toBeTruthy();
    expect(screen.getByText('Classic Taper Fade & Lineup')).toBeTruthy();
  });

  it('renders the catalogue service for each item (Classic Haircut appears twice)', async () => {
    await render(<LookbookGallery />);
    expect(screen.getAllByText('Classic Haircut').length).toBe(2); // two items map to this service
    expect(screen.getByText('Modern Skin Fade')).toBeTruthy();
    expect(screen.getByText('Beard Trim & Shave')).toBeTruthy();
  });

  it('renders category badges with formatted text', async () => {
    await render(<LookbookGallery />);
    // The category badge renders as "Haircuts" (not uppercase), and has multiple occurrences
    expect(screen.getAllByText('Haircuts').length).toBe(3); // 3 Haircuts items
    expect(screen.getByText('Shaves')).toBeTruthy();
  });

  it('calls onSelectStyle when "Book This Look" is pressed', async () => {
    const handleSelect = jest.fn();
    await render(<LookbookGallery onSelectStyle={handleSelect} />);
    fireEvent.press(screen.getAllByText('Book This Look')[0]);
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', title: 'Executive Pompadour & Beard Trim' })
    );
  });

  it('does not render book buttons when onSelectStyle is not provided', async () => {
    await render(<LookbookGallery />);
    expect(screen.queryByText('Book This Look')).toBeNull();
  });
});
