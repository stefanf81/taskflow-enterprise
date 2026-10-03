import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { colors } from '../../theme/colors';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Could not load data',
  message,
  onRetry,
  retryLabel,
  testID = 'error-state',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.text.muted} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <Button
          title={retryLabel ?? 'Retry'}
          variant="secondary"
          size="sm"
          onPress={onRetry}
          style={styles.retryButton}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  message: {
    color: colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  retryButton: {
    marginTop: 16,
  },
});
