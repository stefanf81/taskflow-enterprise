import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CustomerTabNavigator } from '../src/navigation/CustomerTabNavigator';

jest.mock('../src/screens/CustomerPortalScreen', () => ({
  CustomerPortalScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/BookingScreen', () => ({
  BookingScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/CatalogScreen', () => ({
  CatalogScreen: () => <>{null}</>,
}));

describe('CustomerTabNavigator', () => {
  it('renders without crashing', async () => {
    const { container } = await render(
      <NavigationContainer>
        <CustomerTabNavigator />
      </NavigationContainer>
    );
    expect(container).toBeTruthy();
  });
});
