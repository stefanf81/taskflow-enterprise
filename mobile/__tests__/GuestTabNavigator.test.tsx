import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { GuestTabNavigator } from '../src/navigation/GuestTabNavigator';

// Mock the screen components
jest.mock('../src/screens/HomeScreen', () => ({
  HomeScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/BookingScreen', () => ({
  BookingScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/CatalogScreen', () => ({
  CatalogScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/LookbookScreen', () => ({
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
