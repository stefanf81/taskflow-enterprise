import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Input } from '../src/components/common/Input';

describe('Input Component', () => {
  it('renders label when provided', async () => {
    const { getByText } = await render(<Input label="Email" value="" onChangeText={() => {}} />);
    expect(getByText('Email')).toBeTruthy();
  });

  it('does not render label when not provided', async () => {
    const { queryByText } = await render(<Input value="" onChangeText={() => {}} />);
    expect(queryByText('Email')).toBeNull();
  });

  it('renders error text when provided', async () => {
    const { getByText } = await render(
      <Input label="Name" value="" onChangeText={() => {}} error="Name is required" />
    );
    expect(getByText('Name is required')).toBeTruthy();
  });

  it('calls onChangeText when text changes', async () => {
    const handleChange = jest.fn();
    const { getByDisplayValue } = await render(<Input value="hello" onChangeText={handleChange} />);
    await fireEvent.changeText(getByDisplayValue('hello'), 'new text');
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith('new text');
  });

  it('accepts and displays value', async () => {
    const { getByDisplayValue } = await render(
      <Input value="test value" onChangeText={() => {}} />
    );
    expect(getByDisplayValue('test value')).toBeTruthy();
  });

  it('applies secureTextEntry when set', async () => {
    const { getByDisplayValue } = await render(
      <Input value="secret" onChangeText={() => {}} secureTextEntry />
    );
    expect(getByDisplayValue('secret')).toBeTruthy();
  });
});
