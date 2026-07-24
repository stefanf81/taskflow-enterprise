import React from 'react';
import { View, Text, TextInput, TextInputProps, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ label, error, icon, style, ...props }) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputContainer, !!error && styles.errorBorder]}>
        {icon && <View style={styles.iconContainer}>{icon}</View>}
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.text.muted}
          {...props}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.obsidian.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    paddingHorizontal: 12,
  },
  iconContainer: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 15,
    paddingVertical: 12,
  },
  errorBorder: {
    borderColor: colors.status.denied,
  },
  errorText: {
    color: colors.status.denied,
    fontSize: 12,
    marginTop: 4,
  },
});
