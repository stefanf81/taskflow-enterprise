import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AdminTabNavigator } from '../src/navigation/AdminTabNavigator';

jest.mock('../src/screens/AdminDashboardScreen', () => ({
  AdminDashboardScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/AdminCatalogScreen', () => ({
  AdminCatalogScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/AdminSchedulesScreen', () => ({
  AdminSchedulesScreen: () => <>{null}</>,
}));
jest.mock('../src/screens/AdminNotificationsScreen', () => ({
  AdminNotificationsScreen: () => <>{null}</>,
}));

describe('AdminTabNavigator', () => {
  it('renders without crashing', async () => {
    const { container } = await render(
      <NavigationContainer>
        <AdminTabNavigator />
      </NavigationContainer>
    );
    expect(container).toBeTruthy();
  });
});
