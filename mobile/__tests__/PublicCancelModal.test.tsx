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
    expect(screen.getByPlaceholderText('e.g. 123e4567-e89b-12d3-a456-426614174000')).toBeTruthy();
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
      <PublicCancelModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />
    );

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), 'john@example.com');
    });
    await act(async () => {
      fireEvent.press(screen.getAllByText('Cancel Appointment')[1]);
    });

    expect(mockMutateAsyncFn).toHaveBeenCalledWith({
      publicId: '123e4567-e89b-12d3-a456-426614174000',
      email: 'john@example.com',
    });
  });

  it('does not force upper-case input (references are lowercase UUIDs)', async () => {
    await render(<PublicCancelModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    const input = screen.getByPlaceholderText('e.g. 123e4567-e89b-12d3-a456-426614174000');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
  });

  it('trims and lower-cases a typed or pasted reference before sending', async () => {
    mockMutateAsyncFn.mockResolvedValueOnce(undefined);
    await render(<PublicCancelModal visible={true} onClose={() => {}} onSuccess={() => {}} />);

    await fireEvent.changeText(
      screen.getByPlaceholderText('e.g. 123e4567-e89b-12d3-a456-426614174000'),
      '  123E4567-E89B-12D3-A456-426614174000 ',
    );
    await fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), ' john@example.com ');
    await fireEvent.press(screen.getAllByText('Cancel Appointment')[1]);

    expect(mockMutateAsyncFn).toHaveBeenCalledWith({
      publicId: '123e4567-e89b-12d3-a456-426614174000',
      email: 'john@example.com',
    });
  });

  it('re-syncs the reference when the modal is reopened with a new initialPublicId', async () => {
    const NEW_ID = '9b2c1d3e-0000-4000-8000-00000000abcd';
    const { rerender } = await render(
      <PublicCancelModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    expect(screen.getByDisplayValue('123e4567-e89b-12d3-a456-426614174000')).toBeTruthy();

    // Close, then reopen for a different booking.
    await rerender(
      <PublicCancelModal visible={false} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    await rerender(
      <PublicCancelModal visible={true} initialPublicId={NEW_ID} onClose={() => {}} onSuccess={() => {}} />,
    );
    expect(screen.getByDisplayValue(NEW_ID)).toBeTruthy();
    expect(screen.queryByDisplayValue('123e4567-e89b-12d3-a456-426614174000')).toBeNull();
  });

  it('shows the server message when the cancellation is rejected', async () => {
    mockMutateAsyncFn.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Booking already cancelled' } } });
    await render(
      <PublicCancelModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    await fireEvent.changeText(screen.getByPlaceholderText('your.email@example.com'), 'john@example.com');
    await fireEvent.press(screen.getAllByText('Cancel Appointment')[1]);
    expect(screen.getByText('Booking already cancelled')).toBeTruthy();
  });
});
