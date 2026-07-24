import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { colors } from '../../theme/colors';

interface CardProps extends ViewProps {
  variant?: 'default' | 'goldBorder';
}

export const Card: React.FC<CardProps> = ({ children, style, variant = 'default', ...props }) => {
  return (
    <View
      style={[
        styles.card,
        variant === 'goldBorder' && styles.goldBorder,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.obsidian.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  goldBorder: {
    borderColor: colors.gold.border,
  },
});
