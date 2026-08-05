import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterRequest } from '@taskflow/schemas';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types/navigation';
import { colors } from '../theme/colors';

export const RegisterScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { register, error, clearError } = useAuthStore();

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterRequest>({
    defaultValues: { fullName: '', email: '', phone: '', password: '' },
    resolver: zodResolver(registerSchema),
  });

  const handleRegister = async (data: RegisterRequest) => {
    clearError();
    setLoading(true);
    try {
      await register(data);
      setLoading(false);
      setSuccess(true);
    } catch {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Ionicons name="person-add" size={44} color={colors.gold.main} />
            <Text style={styles.title}>Create Customer Account</Text>
            <Text style={styles.subtitle}>
              Register to manage your bookings and view appointment history
            </Text>
          </View>

          {success ? (
            <Card style={styles.card} variant="goldBorder">
              <Ionicons
                name="checkmark-circle"
                size={48}
                color={colors.status.approved}
                style={{ alignSelf: 'center', marginBottom: 12 }}
              />
              <Text style={styles.successTitle}>
                Account Registered Successfully!
              </Text>
              <Text style={styles.successSub}>
                You can now sign in with your email and password.
              </Text>
              <Button
                title="Go to Sign In"
                variant="primary"
                size="lg"
                onPress={() => navigation.navigate('Login')}
                style={{ marginTop: 16 }}
              />
            </Card>
          ) : (
            <Card style={styles.card}>
              <ErrorMessage message={error || ''} />

              <Controller
                control={control}
                name="fullName"
                render={({ field: { onBlur, onChange, value } }) => (
                  <Input
                    label="Full Name *"
                    placeholder="e.g. Jane Smith"
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    error={errors.fullName?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="email"
                render={({ field: { onBlur, onChange, value } }) => (
                  <Input
                    label="Email Address *"
                    placeholder="jane.smith@example.com"
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    error={errors.email?.message}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                )}
              />

              <Controller
                control={control}
                name="phone"
                render={({ field: { onBlur, onChange, value } }) => (
                  <Input
                    label="Phone Number *"
                    placeholder="+1 (555) 000-0000"
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    error={errors.phone?.message}
                    keyboardType="phone-pad"
                  />
                )}
              />

              <Controller
                control={control}
                name="password"
                render={({ field: { onBlur, onChange, value } }) => (
                  <Input
                    label="Password *"
                    placeholder="••••••••"
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    error={errors.password?.message}
                    secureTextEntry
                  />
                )}
              />

              <Button
                title="Create Account"
                variant="primary"
                size="lg"
                loading={loading}
                onPress={handleSubmit(handleRegister)}
                style={styles.submitBtn}
              />
            </Card>
          )}

          <TouchableOpacity
            style={styles.loginTouch}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.loginText}>
              Already have an account?{' '}
              <Text style={styles.loginHighlight}>Sign in here</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
  },
  title: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 12,
  },
  card: {
    padding: 20,
  },
  submitBtn: {
    marginTop: 8,
  },
  successTitle: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  successSub: {
    color: colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  loginTouch: {
    marginTop: 20,
    alignItems: 'center',
  },
  loginText: {
    color: colors.text.secondary,
    fontSize: 13,
  },
  loginHighlight: {
    color: colors.gold.main,
    fontWeight: '700',
  },
});
