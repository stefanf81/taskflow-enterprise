import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import {
  NavigationContainer,
  NavigationContainerRef,
  CommonActions,
} from '@react-navigation/native';
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
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const prevAuthRef = useRef<{ isAuthenticated: boolean; role: string | null }>({
    isAuthenticated: false,
    role: null,
  });

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Reset navigation stack when auth state changes
  useEffect(() => {
    const prev = prevAuthRef.current;
    if (
      prev.isAuthenticated !== isAuthenticated ||
      prev.role !== role
    ) {
      prevAuthRef.current = { isAuthenticated, role };
      navigationRef.current?.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'GuestTabs' }],
        }),
      );
    }
  }, [isAuthenticated, role]);

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.gold.main} />
      </View>
    );
  }

  // Determine the initial route based on auth state
  const getInitialRouteName = (): keyof RootStackParamList => {
    if (!isAuthenticated) return 'GuestTabs';
    if (role === 'ROLE_CUSTOMER') return 'CustomerTabs';
    return 'AdminTabs';
  };

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName={getInitialRouteName()}
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
        {/* Guest screens */}
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

        {/* Authenticated screens */}
        <Stack.Screen
          name="CustomerTabs"
          component={CustomerTabNavigator}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="AdminTabs"
          component={AdminTabNavigator}
          options={{ headerShown: false }}
        />

        {/* Public actions – always available */}
        <Stack.Screen
          name="PublicActions"
          component={PublicActionsScreen}
          options={{ title: 'Manage Booking' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
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
