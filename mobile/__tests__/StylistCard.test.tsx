import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { StylistCard } from '../src/components/booking/StylistCard';

describe('StylistCard Component', () => {
  it('renders stylist details correctly', async () => {
    await render(
      <StylistCard
        name="Alex the Barber"
        title="Master Stylist"
        specialty="Classic Scissor Cuts"
        rating="4.9 ★"
        reviewsCount="12 reviews"
      />
    );

    expect(screen.getByText('Alex the Barber')).toBeTruthy();
    expect(screen.getByText('Master Stylist')).toBeTruthy();
    expect(screen.getByText('Classic Scissor Cuts')).toBeTruthy();
    expect(screen.getByText('4.9 ★')).toBeTruthy();
  });

  it('triggers onSelect callback when button pressed', async () => {
    const onSelectMock = jest.fn();
    await render(
      <StylistCard
        name="Sara the Stylist"
        title="Skin Fade Expert"
        specialty="Skin Fades"
        onSelect={onSelectMock}
      />
    );

    fireEvent.press(screen.getByText('Select'));
    expect(onSelectMock).toHaveBeenCalledTimes(1);
  });
});
