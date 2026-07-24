import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'calendar-outline',
  title,
  message,
}) => {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.text.muted} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
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
});
