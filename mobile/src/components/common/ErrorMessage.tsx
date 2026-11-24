import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, semantic, withAlpha } from '../../theme/colors';

interface ErrorProps {
  message: string;
}

export const ErrorMessage: React.FC<ErrorProps> = ({ message }) => {
  if (!message) return null;

  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={20} color={colors.status.denied} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(semantic.danger, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(semantic.danger, 0.3),
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  text: {
    color: colors.status.denied,
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
  },
});
