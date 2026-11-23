import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, semantic, withAlpha } from '../../theme/colors';

interface BadgeProps {
  status: string;
}

export const Badge: React.FC<BadgeProps> = ({ status }) => {
  const normalized = status ? status.toUpperCase() : 'PENDING';

  let bg = colors.obsidian.surface;
  let text = colors.text.secondary;

  if (normalized === 'APPROVED') {
    bg = withAlpha(semantic.success, 0.15);
    text = colors.status.approved;
  } else if (normalized === 'PENDING') {
    bg = withAlpha(semantic.warning, 0.15);
    text = colors.status.pending;
  } else if (normalized === 'DENIED' || normalized === 'CANCELLED') {
    bg = withAlpha(semantic.danger, 0.15);
    text = colors.status.denied;
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>{normalized}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
