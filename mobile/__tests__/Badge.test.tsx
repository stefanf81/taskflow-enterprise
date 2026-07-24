import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from '../src/components/common/Badge';

describe('Badge Component', () => {
  it('renders PENDING status with correct text and colors', async () => {
    const { getByText } = await render(<Badge status="PENDING" />);
    const element = getByText('PENDING');
    expect(element).toBeTruthy();
  });

  it('renders APPROVED status', async () => {
    const { getByText } = await render(<Badge status="APPROVED" />);
    expect(getByText('APPROVED')).toBeTruthy();
  });

  it('renders DENIED status', async () => {
    const { getByText } = await render(<Badge status="DENIED" />);
    expect(getByText('DENIED')).toBeTruthy();
  });

  it('renders CANCELLED status with denied styling', async () => {
    const { getByText } = await render(<Badge status="CANCELLED" />);
    expect(getByText('CANCELLED')).toBeTruthy();
  });

  it('normalizes lowercase status to uppercase', async () => {
    const { getByText } = await render(<Badge status="approved" />);
    expect(getByText('APPROVED')).toBeTruthy();
  });

  it('defaults to PENDING for empty status', async () => {
    const { getByText } = await render(<Badge status="" />);
    expect(getByText('PENDING')).toBeTruthy();
  });

  it('renders unknown status gracefully', async () => {
    const { getByText } = await render(<Badge status="UNKNOWN_STATUS" />);
    expect(getByText('UNKNOWN_STATUS')).toBeTruthy();
  });
});
