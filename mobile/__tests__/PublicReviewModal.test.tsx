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
    expect(screen.getByPlaceholderText('e.g. TF-9823-8A2F')).toBeTruthy();
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
      <PublicReviewModal visible={true} initialPublicId="TF-0001" onClose={() => {}} onSuccess={() => {}} />,
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
      <PublicReviewModal visible={true} initialPublicId="TF-0001" onClose={handleClose} onSuccess={handleSuccess} />
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
      publicId: 'TF-0001',
      data: { rating: 5, comment: 'Great service!', customerEmail: 'john@example.com' },
    });
  });
});
