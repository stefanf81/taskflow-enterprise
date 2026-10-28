import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AdminTabNavigator } from '../src/navigation/AdminTabNavigator';

jest.mock('../src/features/admin/AdminDashboardScreen', () => ({
  AdminDashboardScreen: () => <>{null}</>,
}));
jest.mock('../src/features/admin/AdminCatalogScreen', () => ({
  AdminCatalogScreen: () => <>{null}</>,
}));
jest.mock('../src/features/admin/AdminSchedulesScreen', () => ({
  AdminSchedulesScreen: () => <>{null}</>,
}));
jest.mock('../src/features/admin/AdminNotificationsScreen', () => ({
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
