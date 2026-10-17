import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../theme/colors';

interface SessionNoticeBannerProps {
  message: string | null;
  onDismiss: () => void;
}

/** App-wide notice (e.g. "session expired") that survives the post-logout navigation reset. */
export const SessionNoticeBanner: React.FC<SessionNoticeBannerProps> = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <View style={styles.container} accessibilityRole="alert" testID="session-notice-banner">
      <Ionicons name="time-outline" size={18} color={colors.gold.main} />
      <Text style={styles.text}>{message}</Text>
      <TouchableOpacity onPress={onDismiss} accessibilityLabel="Dismiss notice">
        <Text style={styles.dismiss}>×</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 76,
    zIndex: 10,
    elevation: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.obsidian.card,
    borderWidth: 1,
    borderColor: colors.gold.main,
    borderRadius: 8,
    padding: 12,
  },
  text: {
    color: colors.text.primary,
    fontSize: 13,
    flex: 1,
    marginLeft: 8,
  },
  dismiss: {
    color: colors.gold.main,
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
});
