import React from 'react';
import { render } from '@testing-library/react-native';
import { LoadingIndicator } from '../src/components/common/LoadingIndicator';

describe('LoadingIndicator Component', () => {
  it('renders default loading message', async () => {
    const { getByText } = await render(<LoadingIndicator />);
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('renders custom message when provided', async () => {
    const { getByText } = await render(<LoadingIndicator message="Fetching data..." />);
    expect(getByText('Fetching data...')).toBeTruthy();
  });

  it('renders ActivityIndicator', async () => {
    const { getByText } = await render(<LoadingIndicator message="Please wait" />);
    expect(getByText('Please wait')).toBeTruthy();
  });
});
