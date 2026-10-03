import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ErrorState } from '../src/components/common/ErrorState';

describe('ErrorState Component', () => {
  it('renders title and message', async () => {
    await render(<ErrorState title="Load Failed" message="Something went wrong." />);
    expect(screen.getByText('Load Failed')).toBeTruthy();
    expect(screen.getByText('Something went wrong.')).toBeTruthy();
  });

  it('renders the default title when none is provided', async () => {
    await render(<ErrorState message="Something went wrong." />);
    expect(screen.getByText('Could not load data')).toBeTruthy();
  });

  it('renders the default testID', async () => {
    await render(<ErrorState message="Something went wrong." />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
  });

  it('calls onRetry when Retry is pressed', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState message="Something went wrong." onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('supports a custom retry label', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState message="Something went wrong." onRetry={onRetry} retryLabel="Try again" />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render a Retry button when onRetry is omitted', async () => {
    await render(<ErrorState message="Something went wrong." />);
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
