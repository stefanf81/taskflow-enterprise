import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TimeSlotPicker } from '../src/components/booking/TimeSlotPicker';

const MOCK_SLOTS = ['09:00', '10:00', '11:00', '13:00'];

describe('TimeSlotPicker Component', () => {
  it('renders all time slots', async () => {
    const { getByText } = await render(
      <TimeSlotPicker slots={MOCK_SLOTS} selectedSlot="" busySlots={[]} onSelectSlot={() => {}} />
    );
    MOCK_SLOTS.forEach((slot) => {
      expect(getByText(slot)).toBeTruthy();
    });
  });

  it('calls onSelectSlot when a free slot is pressed', async () => {
    const handleSelect = jest.fn();
    const { getByText } = await render(
      <TimeSlotPicker slots={MOCK_SLOTS} selectedSlot="" busySlots={[]} onSelectSlot={handleSelect} />
    );
    fireEvent.press(getByText('10:00'));
    expect(handleSelect).toHaveBeenCalledWith('10:00');
  });

  it('disables busy slots', async () => {
    const handleSelect = jest.fn();
    const { getByText } = await render(
      <TimeSlotPicker slots={MOCK_SLOTS} selectedSlot="" busySlots={['10:00']} onSelectSlot={handleSelect} />
    );
    fireEvent.press(getByText('10:00'));
    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('shows "Booked" label for busy slots', async () => {
    const { getByText } = await render(
      <TimeSlotPicker slots={MOCK_SLOTS} selectedSlot="" busySlots={['10:00']} onSelectSlot={() => {}} />
    );
    expect(getByText('Booked')).toBeTruthy();
  });

  it('highlights the selected slot', async () => {
    const { getByText } = await render(
      <TimeSlotPicker slots={MOCK_SLOTS} selectedSlot="11:00" busySlots={[]} onSelectSlot={() => {}} />
    );
    expect(getByText('11:00')).toBeTruthy();
  });
});
