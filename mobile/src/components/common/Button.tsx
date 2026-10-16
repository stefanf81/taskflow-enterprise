import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
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
    const sizeStyle: ViewStyle =
      size === 'sm'
        ? { paddingVertical: 8, paddingHorizontal: 12 }
        : size === 'lg'
          ? { paddingVertical: 16, paddingHorizontal: 24 }
          : { paddingVertical: 12, paddingHorizontal: 16 };

    let variantStyle: ViewStyle = {};
    if (variant === 'primary') {
      variantStyle = { backgroundColor: colors.gold.main };
    } else if (variant === 'secondary') {
      variantStyle = {
        backgroundColor: colors.obsidian.surface,
        borderWidth: 1,
        borderColor: colors.obsidian.border,
      };
    } else if (variant === 'outline') {
      variantStyle = { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.gold.main };
    } else if (variant === 'danger') {
      variantStyle = { backgroundColor: colors.status.denied };
    }

    return {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      ...sizeStyle,
      ...variantStyle,
      ...(disabled || loading ? { opacity: 0.6 } : null),
    };
  };

  const getTextStyle = (): TextStyle => ({
    fontWeight: '600',
    fontSize: size === 'sm' ? 12 : size === 'lg' ? 18 : 14,
    color:
      variant === 'primary'
        ? colors.obsidian.bg
        : variant === 'outline'
          ? colors.gold.main
          : colors.text.primary,
  });

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
