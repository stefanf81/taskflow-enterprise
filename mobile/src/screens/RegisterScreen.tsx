import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { register, error, clearError } = useAuthStore();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleRegister = async () => {
    if (!fullName.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      return;
    }

    clearError();
    setLoading(true);
    try {
      await register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
      });
      setLoading(false);
      setSuccess(true);
    } catch {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Ionicons name="person-add" size={44} color={colors.gold.main} />
          <Text style={styles.title}>Create Customer Account</Text>
          <Text style={styles.subtitle}>Register to manage your bookings and view appointment history</Text>
        </View>

        {success ? (
          <Card style={styles.card} variant="goldBorder">
            <Ionicons
              name="checkmark-circle"
              size={48}
              color={colors.status.approved}
              style={{ alignSelf: 'center', marginBottom: 12 }}
            />
            <Text style={styles.successTitle}>Account Registered Successfully!</Text>
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

            <Input
              label="Full Name *"
              placeholder="e.g. Jane Smith"
              value={fullName}
              onChangeText={setFullName}
            />

            <Input
              label="Email Address *"
              placeholder="jane.smith@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Input
              label="Phone Number *"
              placeholder="+1 (555) 000-0000"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <Input
              label="Password *"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Button
              title="Create Account"
              variant="primary"
              size="lg"
              loading={loading}
              onPress={handleRegister}
              style={styles.submitBtn}
            />
          </Card>
        )}

        <TouchableOpacity
          style={styles.loginTouch}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.loginText}>
            Already have an account? <Text style={styles.loginHighlight}>Sign in here</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
