import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
import { AdminCatalogScreen } from '../screens/AdminCatalogScreen';
import { AdminSchedulesScreen } from '../screens/AdminSchedulesScreen';
import { AdminNotificationsScreen } from '../screens/AdminNotificationsScreen';
import { AdminTabParamList } from '../types/navigation';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator<AdminTabParamList>();

export const AdminTabNavigator: React.FC = () => {
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
          let iconName: keyof typeof Ionicons.glyphMap = 'grid';

          if (route.name === 'AdminAppointments') iconName = 'grid-outline';
          else if (route.name === 'AdminCatalog') iconName = 'cut-outline';
          else if (route.name === 'AdminSchedules') iconName = 'people-outline';
          else if (route.name === 'AdminNotifications') iconName = 'mail-outline';

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="AdminAppointments"
        component={AdminDashboardScreen}
        options={{ tabBarLabel: 'Dashboard' }}
      />
      <Tab.Screen
        name="AdminCatalog"
        component={AdminCatalogScreen}
        options={{ tabBarLabel: 'Catalog' }}
      />
      <Tab.Screen
        name="AdminSchedules"
        component={AdminSchedulesScreen}
        options={{ tabBarLabel: 'Schedules' }}
      />
      <Tab.Screen
        name="AdminNotifications"
        component={AdminNotificationsScreen}
        options={{ tabBarLabel: 'Outbox' }}
      />
    </Tab.Navigator>
  );
};
