import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PublicActionsScreen } from '../src/features/landing/PublicActionsScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { publicId: 'TF-0001' } }),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// Mock modal components
jest.mock('../src/features/landing/PublicCancelModal', () => ({
  PublicCancelModal: ({ visible, onClose }: { visible: boolean; onClose: () => void }) =>
    visible ? <>{null}</> : null,
}));

jest.mock('../src/features/landing/PublicReviewModal', () => ({
  PublicReviewModal: ({ visible, onClose }: { visible: boolean; onClose: () => void }) =>
    visible ? <>{null}</> : null,
}));

let mockRescheduleVisible = false;
jest.mock('../src/features/landing/PublicRescheduleModal', () => ({
  PublicRescheduleModal: ({ visible }: { visible: boolean }) => {
    mockRescheduleVisible = visible;
    return null;
  },
}));

describe('PublicActionsScreen', () => {
  it('renders the manage booking screen', async () => {
    const { getByText } = await render(<PublicActionsScreen />);
    expect(getByText('Manage Public Booking')).toBeTruthy();
  });

  it('renders cancel appointment card', async () => {
    const { getByText } = await render(<PublicActionsScreen />);
    expect(getByText('Cancel Appointment')).toBeTruthy();
    expect(getByText('Cancel an Appointment')).toBeTruthy();
  });

  it('renders review card', async () => {
    const { getByText } = await render(<PublicActionsScreen />);
    expect(getByText('Leave a Review & Rating')).toBeTruthy();
    expect(getByText('Write Barber Review')).toBeTruthy();
  });

  it('renders subtitle with self-service instructions', async () => {
    const { getByText } = await render(<PublicActionsScreen />);
    expect(getByText(/Self-service options/)).toBeTruthy();
  });

  it('offers rescheduling as its own action', async () => {
    const { getByText } = await render(<PublicActionsScreen />);
    expect(getByText('Reschedule Appointment')).toBeTruthy();
    expect(mockRescheduleVisible).toBe(false);
    await fireEvent.press(getByText('Reschedule an Appointment'));
    expect(mockRescheduleVisible).toBe(true);
  });
});
