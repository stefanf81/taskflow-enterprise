import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GuestTabNavigator } from './GuestTabNavigator';
import { CustomerTabNavigator } from './CustomerTabNavigator';
import { AdminTabNavigator } from './AdminTabNavigator';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { PublicActionsScreen } from '../screens/PublicActionsScreen';
import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types/navigation';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const { isAuthenticated, role, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.gold.main} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.obsidian.card,
        },
        headerTintColor: colors.gold.main,
        headerTitleStyle: {
          fontWeight: '700',
        },
        contentStyle: {
          backgroundColor: colors.obsidian.bg,
        },
      }}
    >
      {!isAuthenticated ? (
        // Guest-only screens
        <>
          <Stack.Screen
            name="GuestTabs"
            component={GuestTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: 'Sign In' }}
          />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Create Account' }}
          />
        </>
      ) : role === 'ROLE_CUSTOMER' ? (
        <Stack.Screen
          name="CustomerTabs"
          component={CustomerTabNavigator}
          options={{ headerShown: false }}
        />
      ) : (
        <Stack.Screen
          name="AdminTabs"
          component={AdminTabNavigator}
          options={{ headerShown: false }}
        />
      )}

      {/* Always available – public actions for managing bookings by reference ID */}
      <Stack.Screen
        name="PublicActions"
        component={PublicActionsScreen}
        options={{ title: 'Manage Booking' }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
