import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { CustomerPortalScreen } from '../screens/CustomerPortalScreen';
import { BookingScreen } from '../screens/BookingScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { CustomerTabParamList } from '../types/navigation';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

export const CustomerTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.gold.main,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarStyle: {
          backgroundColor: colors.obsidian.card,
          borderTopColor: colors.obsidian.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarIcon: ({ color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'person';

          if (route.name === 'CustomerAppointments') iconName = 'clipboard-outline';
          else if (route.name === 'NewBooking') iconName = 'add-circle-outline';
          else if (route.name === 'CustomerCatalog') iconName = 'list-outline';

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="CustomerAppointments"
        component={CustomerPortalScreen}
        options={{ tabBarLabel: 'My Bookings' }}
      />
      <Tab.Screen
        name="NewBooking"
        component={BookingScreen}
        options={{ tabBarLabel: 'New Booking' }}
      />
      <Tab.Screen
        name="CustomerCatalog"
        component={CatalogScreen}
        options={{ tabBarLabel: 'Catalog' }}
      />
    </Tab.Navigator>
  );
};
