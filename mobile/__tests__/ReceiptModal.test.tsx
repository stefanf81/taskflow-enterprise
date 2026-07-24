import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ReceiptModal } from '../src/components/booking/ReceiptModal';

const mockAppointment = {
  id: 1,
  publicId: 'TF-0001',
  customerName: 'John Doe',
  customerEmail: 'john@example.com',
  customerPhone: '+1-555-0000',
  barberName: 'Alex the Barber',
  bookingDate: '2026-08-01',
  bookingTime: '10:00',
  serviceType: 'Classic Haircut',
  status: 'PENDING' as const,
  createdAt: '2026-07-24T10:00:00',
  updatedAt: '2026-07-24T10:00:00',
};

describe('ReceiptModal Component', () => {
  it('renders null when appointment is null', async () => {
    const { container } = await render(
      <ReceiptModal visible={true} appointment={null} onClose={() => {}} />
    );
    expect(container.children.length).toBe(0);
  });

  it('renders appointment details when visible', async () => {
    const { getByText } = await render(
      <ReceiptModal visible={true} appointment={mockAppointment} checkoutTotal={47.50} onClose={() => {}} />
    );
    expect(getByText('Booking Confirmation')).toBeTruthy();
    expect(getByText('Appointment Reserved!')).toBeTruthy();
    expect(getByText('TF-0001')).toBeTruthy();
    expect(getByText('John Doe')).toBeTruthy();
    expect(getByText('Classic Haircut')).toBeTruthy();
    expect(getByText('Alex the Barber')).toBeTruthy();
    expect(getByText('$47.50')).toBeTruthy();
  });

  it('calls onClose when "Done" button pressed', async () => {
    const handleClose = jest.fn();
    const { getByText } = await render(
      <ReceiptModal visible={true} appointment={mockAppointment} onClose={handleClose} />
    );
    fireEvent.press(getByText('Done'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders share button', async () => {
    const { getByText } = await render(
      <ReceiptModal visible={true} appointment={mockAppointment} onClose={() => {}} />
    );
    expect(getByText('Share Booking Details')).toBeTruthy();
  });

  it('renders manage/review button when onOpenPublicActions is provided', async () => {
    const { getByText } = await render(
      <ReceiptModal
        visible={true}
        appointment={mockAppointment}
        onClose={() => {}}
        onOpenPublicActions={jest.fn()}
      />
    );
    expect(getByText('Manage / Review Booking')).toBeTruthy();
  });
});
