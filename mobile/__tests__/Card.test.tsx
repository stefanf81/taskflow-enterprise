import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card } from '../src/components/common/Card';

describe('Card Component', () => {
  it('renders children content', async () => {
    const { getByText } = await render(
      <Card><Text>Card Content</Text></Card>
    );
    expect(getByText('Card Content')).toBeTruthy();
  });

  it('applies default variant styles', async () => {
    const { getByText } = await render(
      <Card><Text>Default</Text></Card>
    );
    expect(getByText('Default')).toBeTruthy();
  });

  it('applies goldBorder variant', async () => {
    const { getByText } = await render(
      <Card variant="goldBorder"><Text>Gold</Text></Card>
    );
    expect(getByText('Gold')).toBeTruthy();
  });

  it('applies custom style on top of default', async () => {
    const { getByText } = await render(
      <Card style={{ marginTop: 10 }}><Text>Styled</Text></Card>
    );
    expect(getByText('Styled')).toBeTruthy();
  });
});
