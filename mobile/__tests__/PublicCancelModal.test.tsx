import React from 'react';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react-native';

const mockMutateAsyncFn = jest.fn();

jest.mock('../src/hooks/useAppointments', () => ({
  usePublicCancelAppointment: () => ({
    mutateAsync: mockMutateAsyncFn,
    isPending: false,
  }),
}));

import { PublicCancelModal } from '../src/components/booking/PublicCancelModal';

describe('PublicCancelModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with form fields', async () => {
    await render(<PublicCancelModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    const modalTitle = screen.getAllByText('Cancel Appointment');
    expect(modalTitle.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText('e.g. TF-9823-8A2F')).toBeTruthy();
    expect(screen.getByPlaceholderText('your.email@example.com')).toBeTruthy();
  });

  it('shows error when fields are empty on submit', async () => {
    await render(<PublicCancelModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Cancel Appointment')[1]);
    });
    await waitFor(() => {
      expect(screen.getByText('Both Public Reference ID and Customer Email are required.')).toBeTruthy();
    });
  });

  it('calls mutateAsync with correct data on valid submission', async () => {
    mockMutateAsyncFn.mockResolvedValueOnce(undefined);
    await render(
      <PublicCancelModal visible={true} initialPublicId="TF-0001" onClose={() => {}} onSuccess={() => {}} />
    );

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), 'john@example.com');
    });
    await act(async () => {
      fireEvent.press(screen.getAllByText('Cancel Appointment')[1]);
    });

    expect(mockMutateAsyncFn).toHaveBeenCalledWith({
      publicId: 'TF-0001',
      email: 'john@example.com',
    });
  });
});
