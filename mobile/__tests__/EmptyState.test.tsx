import React from 'react';
import { render } from '@testing-library/react-native';
import { EmptyState } from '../src/components/common/EmptyState';

describe('EmptyState Component', () => {
  it('renders title and message', async () => {
    const { getByText } = await render(
      <EmptyState title="No Data" message="Nothing to show here." />
    );
    expect(getByText('No Data')).toBeTruthy();
    expect(getByText('Nothing to show here.')).toBeTruthy();
  });

  it('uses default icon when none provided', async () => {
    const { getByText } = await render(
      <EmptyState title="Empty" message="It is empty." />
    );
    expect(getByText('Empty')).toBeTruthy();
  });

  it('accepts custom icon name', async () => {
    const { getByText } = await render(
      <EmptyState icon="search-outline" title="Search" message="No results." />
    );
    expect(getByText('Search')).toBeTruthy();
  });
});
