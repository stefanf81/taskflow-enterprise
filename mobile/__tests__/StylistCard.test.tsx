import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StylistCard } from '../src/components/booking/StylistCard';

describe('StylistCard Component', () => {
  it('renders stylist details correctly', () => {
    const { getByText } = render(
      <StylistCard
        name="Alex the Barber"
        title="Master Stylist"
        specialty="Classic Scissor Cuts"
        rating="4.9 ★"
        reviewsCount="12 reviews"
      />
    );

    expect(getByText('Alex the Barber')).toBeTruthy();
    expect(getByText('Master Stylist')).toBeTruthy();
    expect(getByText('Classic Scissor Cuts')).toBeTruthy();
    expect(getByText('4.9 ★')).toBeTruthy();
  });

  it('triggers onSelect callback when button pressed', () => {
    const onSelectMock = jest.fn();
    const { getByText } = render(
      <StylistCard
        name="Sara the Stylist"
        title="Skin Fade Expert"
        specialty="Skin Fades"
        onSelect={onSelectMock}
      />
    );

    fireEvent.press(getByText('Select'));
    expect(onSelectMock).toHaveBeenCalledTimes(1);
  });
});
