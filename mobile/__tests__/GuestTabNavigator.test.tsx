import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { GuestTabNavigator } from '../src/navigation/GuestTabNavigator';

// Mock the screen components
jest.mock('../src/features/landing/HomeScreen', () => ({
  HomeScreen: () => <>{null}</>,
}));
jest.mock('../src/features/booking/BookingScreen', () => ({
  BookingScreen: () => <>{null}</>,
}));
jest.mock('../src/features/landing/CatalogScreen', () => ({
  CatalogScreen: () => <>{null}</>,
}));
jest.mock('../src/features/landing/LookbookScreen', () => ({
  LookbookScreen: () => <>{null}</>,
}));

describe('GuestTabNavigator', () => {
  it('renders without crashing', async () => {
    const { container } = await render(
      <NavigationContainer>
        <GuestTabNavigator />
      </NavigationContainer>
    );
    expect(container).toBeTruthy();
  });
});
