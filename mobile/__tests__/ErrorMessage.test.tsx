import React from 'react';
import { render } from '@testing-library/react-native';
import { ErrorMessage } from '../src/components/common/ErrorMessage';

describe('ErrorMessage Component', () => {
  it('renders the error message text', async () => {
    const { getByText } = await render(<ErrorMessage message="Something went wrong" />);
    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('returns null when message is empty', async () => {
    const { queryByText } = await render(<ErrorMessage message="" />);
    expect(queryByText('')).toBeNull();
  });

  it('returns null when message is falsy', async () => {
    const { container } = await render(<ErrorMessage message={'' as string} />);
    expect(container.children.length).toBe(0);
  });
});
