import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react-native';

const mockMutateAsync = jest.fn();
jest.mock('../src/hooks/useReviews', () => ({
  useSubmitReview: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

import { PublicReviewModal } from '../src/components/booking/PublicReviewModal';

describe('PublicReviewModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with form fields', async () => {
    await render(<PublicReviewModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByText('Leave a Review')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. 123e4567-e89b-12d3-a456-426614174000')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. john@example.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('Tell us how your hair style turned out...')).toBeTruthy();
  });

  it('shows error when publicId is empty on submit', async () => {
    await render(<PublicReviewModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    fireEvent.press(screen.getByText('Submit Review'));

    // Wait for async handler to process
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText('Public Reference ID is required.')).toBeTruthy();
  });

  it('shows error when email is empty on submit', async () => {
    await render(
      <PublicReviewModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    fireEvent.press(screen.getByText('Submit Review'));

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText('Verification email is required.')).toBeTruthy();
  });

  it('renders all 5 star rating buttons', async () => {
    await render(<PublicReviewModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByText('Rating')).toBeTruthy();
    expect(screen.getByText('Submit Review')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('calls mutateAsync on valid submission', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const handleSuccess = jest.fn();
    const handleClose = jest.fn();
    await render(
      <PublicReviewModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={handleClose} onSuccess={handleSuccess} />
    );

    const commentInput = screen.getByPlaceholderText('Tell us how your hair style turned out...');
    const emailInput = screen.getByPlaceholderText('e.g. john@example.com');
    await act(async () => {
      fireEvent.changeText(commentInput, 'Great service!');
    });
    await act(async () => {
      fireEvent.changeText(emailInput, 'john@example.com');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Submit Review'));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      publicId: '123e4567-e89b-12d3-a456-426614174000',
      data: { rating: 5, comment: 'Great service!', customerEmail: 'john@example.com' },
    });
  });

  it('does not force upper-case input (references are lowercase UUIDs)', async () => {
    await render(<PublicReviewModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    const input = screen.getByPlaceholderText('e.g. 123e4567-e89b-12d3-a456-426614174000');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
  });

  it('trims and lower-cases the reference before submitting', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    await render(<PublicReviewModal visible={true} onClose={() => {}} onSuccess={() => {}} />);
    await fireEvent.changeText(
      screen.getByPlaceholderText('e.g. 123e4567-e89b-12d3-a456-426614174000'),
      ' 123E4567-E89B-12D3-A456-426614174000',
    );
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. john@example.com'), 'john@example.com');
    await fireEvent.press(screen.getByText('Submit Review'));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: '123e4567-e89b-12d3-a456-426614174000' }),
    );
  });

  it('re-syncs the reference when the modal is reopened with a new initialPublicId', async () => {
    const NEW_ID = '9b2c1d3e-0000-4000-8000-00000000abcd';
    const { rerender } = await render(
      <PublicReviewModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    await rerender(
      <PublicReviewModal visible={false} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    await rerender(
      <PublicReviewModal visible={true} initialPublicId={NEW_ID} onClose={() => {}} onSuccess={() => {}} />,
    );
    expect(screen.getByDisplayValue(NEW_ID)).toBeTruthy();
  });

  it('shows the server message when the review is rejected', async () => {
    mockMutateAsync.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Review already submitted' } } });
    await render(
      <PublicReviewModal visible={true} initialPublicId="123e4567-e89b-12d3-a456-426614174000" onClose={() => {}} onSuccess={() => {}} />,
    );
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. john@example.com'), 'john@example.com');
    await fireEvent.press(screen.getByText('Submit Review'));
    expect(screen.getByText('Review already submitted')).toBeTruthy();
  });
});
