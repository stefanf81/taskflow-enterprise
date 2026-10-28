import React from 'react';
import { render } from '@testing-library/react-native';
import { LookbookScreen } from '../src/features/landing/LookbookScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../src/features/landing/LookbookGallery', () => ({
  LookbookGallery: () => <>{null}</>,
}));

describe('LookbookScreen', () => {
  it('renders lookbook title', async () => {
    const { getByText } = await render(<LookbookScreen />);
    expect(getByText('Style Lookbook')).toBeTruthy();
  });

  it('renders subtitle', async () => {
    const { getByText } = await render(<LookbookScreen />);
    expect(getByText(/Explore signature cuts/)).toBeTruthy();
  });
});
