import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { BookingScreen } from '../screens/BookingScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { LookbookScreen } from '../screens/LookbookScreen';
import { GuestTabParamList } from '../types/navigation';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator<GuestTabParamList>();

export const GuestTabNavigator: React.FC = () => {
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
          let iconName: keyof typeof Ionicons.glyphMap = 'home';

          if (route.name === 'Home') iconName = 'home-outline';
          else if (route.name === 'Booking') iconName = 'calendar-outline';
          else if (route.name === 'Catalog') iconName = 'list-outline';
          else if (route.name === 'Lookbook') iconName = 'images-outline';

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="Booking" component={BookingScreen} options={{ tabBarLabel: 'Book', tabBarButtonTestID: 'tab-booking' }} />
      <Tab.Screen name="Catalog" component={CatalogScreen} options={{ tabBarLabel: 'Catalog' }} />
      <Tab.Screen name="Lookbook" component={LookbookScreen} options={{ tabBarLabel: 'Styles' }} />
    </Tab.Navigator>
  );
};
