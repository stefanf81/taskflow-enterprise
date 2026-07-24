import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Button } from '../src/components/common/Button';

describe('Button Component', () => {
  it('renders button title correctly', async () => {
    await render(<Button title="Book Now" onPress={() => {}} />);
    expect(screen.getByText('Book Now')).toBeTruthy();
  });

  it('triggers onPress callback when clicked', async () => {
    const onPressMock = jest.fn();
    await render(<Button title="Submit" onPress={onPressMock} />);
    fireEvent.press(screen.getByText('Submit'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('disables button when loading is true', async () => {
    const onPressMock = jest.fn();
    await render(
      <Button title="Submit" loading={true} onPress={onPressMock} />
    );
    expect(screen.queryByText('Submit')).toBeNull();
  });
});
