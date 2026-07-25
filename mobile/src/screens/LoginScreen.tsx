import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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

export const LoginScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { login, error, clearError } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      return;
    }

    clearError();
    setLoading(true);
    try {
      await login({ username: username.trim(), password });
      // Navigation is handled by RootNavigator reacting to auth state change
    } catch {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="lock-closed" size={48} color={colors.gold.main} />
          <Text style={styles.title}>Sign In to TaskFlow</Text>
          <Text style={styles.subtitle}>Enter your credentials to access your portal</Text>
        </View>

        <Card style={styles.card} variant="goldBorder">
          <ErrorMessage message={error || ''} />

          <Input
            label="Username or Email"
            placeholder="admin or customer@example.com"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            icon={<Ionicons name="person-outline" size={18} color={colors.text.muted} />}
          />

          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            icon={<Ionicons name="key-outline" size={18} color={colors.text.muted} />}
          />

          <Button
            title="Sign In"
            variant="primary"
            size="lg"
            loading={loading}
            onPress={handleLogin}
            style={styles.submitBtn}
          />
        </Card>

        {/* Register link */}
        <TouchableOpacity
          style={styles.registerTouch}
          onPress={() => navigation.navigate('Register')}
        >
          <Text style={styles.registerText}>
            Don't have a customer account? <Text style={styles.registerHighlight}>Register here</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: colors.text.primary,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 12,
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 4,
  },
  card: {
    padding: 20,
  },
  submitBtn: {
    marginTop: 8,
  },
  registerTouch: {
    marginTop: 20,
    alignItems: 'center',
  },
  registerText: {
    color: colors.text.secondary,
    fontSize: 13,
  },
  registerHighlight: {
    color: colors.gold.main,
    fontWeight: '700',
  },
});
