import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacityProps,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors } from '../../theme/colors';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  style,
  disabled,
  ...props
}) => {
  const getButtonStyle = (): ViewStyle => {
    let base: ViewStyle = {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    };

    // Size
    if (size === 'sm') {
      base.paddingVertical = 8;
      base.paddingHorizontal = 12;
    } else if (size === 'lg') {
      base.paddingVertical = 16;
      base.paddingHorizontal = 24;
    } else {
      base.paddingVertical = 12;
      base.paddingHorizontal = 16;
    }

    // Variant
    if (variant === 'primary') {
      base.backgroundColor = colors.gold.main;
    } else if (variant === 'secondary') {
      base.backgroundColor = colors.obsidian.surface;
      base.borderWidth = 1;
      base.borderColor = colors.obsidian.border;
    } else if (variant === 'outline') {
      base.backgroundColor = 'transparent';
      base.borderWidth = 1;
      base.borderColor = colors.gold.main;
    } else if (variant === 'danger') {
      base.backgroundColor = colors.status.denied;
    }

    if (disabled || loading) {
      base.opacity = 0.6;
    }

    return base;
  };

  const getTextStyle = (): TextStyle => {
    let base: TextStyle = {
      fontWeight: '600',
    };

    if (size === 'sm') {
      base.fontSize = 12;
    } else if (size === 'lg') {
      base.fontSize = 18;
    } else {
      base.fontSize = 14;
    }

    if (variant === 'primary') {
      base.color = colors.obsidian.bg;
    } else if (variant === 'outline') {
      base.color = colors.gold.main;
    } else {
      base.color = colors.text.primary;
    }

    return base;
  };

  return (
    <TouchableOpacity
      style={[getButtonStyle(), style]}
      disabled={disabled || loading}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: loading }}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.obsidian.bg : colors.gold.main}
        />
      ) : (
        <>
          {icon}
          <Text style={[getTextStyle(), icon ? { marginLeft: 8 } : null]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};
