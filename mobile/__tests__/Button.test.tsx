import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../src/components/common/Button';

describe('Button Component', () => {
  it('renders button title correctly', () => {
    const { getByText } = render(<Button title="Book Now" onPress={() => {}} />);
    expect(getByText('Book Now')).toBeTruthy();
  });

  it('triggers onPress callback when clicked', () => {
    const onPressMock = jest.fn();
    const { getByText } = render(<Button title="Submit" onPress={onPressMock} />);
    fireEvent.press(getByText('Submit'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('disables button when loading is true', () => {
    const onPressMock = jest.fn();
    const { queryByText } = render(
      <Button title="Submit" loading={true} onPress={onPressMock} />
    );
    expect(queryByText('Submit')).toBeNull();
  });
});
