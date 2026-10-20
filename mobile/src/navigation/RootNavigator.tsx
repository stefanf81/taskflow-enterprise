import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
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
import { SessionNoticeBanner } from '../components/common/SessionNoticeBanner';
import { useAuthStore } from '../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RootStackParamList } from '../types/navigation';
import { colors } from '../theme/colors';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const {
    isAuthenticated,
    role,
    isBootstrapping,
    isOffline,
    sessionNotice,
    checkAuth,
    logout,
    clearSessionNotice,
  } = useAuthStore(
    useShallow((state) => ({
      isAuthenticated: state.isAuthenticated,
      role: state.role,
      isBootstrapping: state.isBootstrapping,
      isOffline: state.isOffline,
      sessionNotice: state.sessionNotice,
      checkAuth: state.checkAuth,
      logout: state.logout,
      clearSessionNotice: state.clearSessionNotice,
    })),
  );
  const isCustomer = isAuthenticated && role === 'ROLE_CUSTOMER';
  const isAdmin = isAuthenticated && role === 'ROLE_ADMIN';
  const hasAuthorizedRole = isCustomer || isAdmin;
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const prevAuthRef = useRef<{ isAuthenticated: boolean; role: string | null }>({
    isAuthenticated: false,
    role: null,
  });

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Every Ionicons instance renders an empty <Text /> until the icon font is registered, so
  // load it alongside the session restore instead of letting the tab bar icons pop in after
  // the splash (Expo fonts guide, "Handle @expo/vector-icons initial load"). A load error
  // only costs the icons, never the app.
  const [iconFontLoaded, iconFontError] = useFonts(Ionicons.font);
  const iconFontSettled = iconFontLoaded || iconFontError != null;

  // Keep the native splash up until the stored session is restored, instead of letting it
  // dismiss on the first JS frame and flash a spinner screen in between.
  useEffect(() => {
    if (!isBootstrapping && iconFontSettled) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [isBootstrapping, iconFontSettled]);

  useEffect(() => {
    if (isAuthenticated && !hasAuthorizedRole) {
      // An unrecognised server role must never receive admin/customer UI.
      // Clear the credential rather than treating every non-customer as admin.
      void logout().catch(() => undefined);
    }
  }, [hasAuthorizedRole, isAuthenticated, logout]);

  // Reset navigation stack when auth state changes
  useEffect(() => {
    const prev = prevAuthRef.current;
    if (
      prev.isAuthenticated !== isAuthenticated ||
      prev.role !== role
    ) {
      prevAuthRef.current = { isAuthenticated, role };

      // Route to the correct navigator based on new auth state,
      // rather than always resetting to GuestTabs (which caused a UX flash).
      const targetRoute = isCustomer ? 'CustomerTabs' : isAdmin ? 'AdminTabs' : 'GuestTabs';

      navigationRef.current?.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: targetRoute as keyof RootStackParamList }],
        }),
      );
    }
  }, [isAdmin, isAuthenticated, isCustomer, role]);

  // Splash only while the stored session is being restored. Sign-in/registration
  // pending state lives in the screens, so a failed attempt never unmounts the
  // NavigationContainer (which used to drop the user on Home and lose the error).
  if (isBootstrapping) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.gold.main} />
      </View>
    );
  }

  if (isOffline) {
    return (
      <View style={styles.splash}>
        <Text style={styles.offlineText}>Could not reach TaskFlow.</Text>
        <Text style={styles.offlineHint}>Check your connection and try again.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => checkAuth()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Determine the initial route based on auth state
  const getInitialRouteName = (): keyof RootStackParamList => {
    if (isCustomer) return 'CustomerTabs';
    if (isAdmin) return 'AdminTabs';
    return 'GuestTabs';
  };

  return (
    <View style={styles.root}>
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
  
          {/* Only register the navigator authorized for the confirmed role. */}
          {isCustomer && (
            <Stack.Screen
              name="CustomerTabs"
              component={CustomerTabNavigator}
              options={{ headerShown: false }}
            />
          )}
          {isAdmin && (
            <Stack.Screen
              name="AdminTabs"
              component={AdminTabNavigator}
              options={{ headerShown: false }}
            />
          )}
  
          {/* Public actions – always available */}
          <Stack.Screen
            name="PublicActions"
            component={PublicActionsScreen}
            options={{ title: 'Manage Booking' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <SessionNoticeBanner message={sessionNotice} onDismiss={clearSessionNotice} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineText: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '700',
  },
  offlineHint: {
    color: colors.text.secondary,
    fontSize: 14,
    marginTop: 8,
  },
  retryButton: {
    backgroundColor: colors.gold.main,
    borderRadius: 8,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: {
    color: colors.obsidian.bg,
    fontWeight: '700',
  },
});
