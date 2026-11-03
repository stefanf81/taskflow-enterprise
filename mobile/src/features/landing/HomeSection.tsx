import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface HomeSectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** A titled block of the landing page (lookbook, stylists, FAQ). */
export const HomeSection: React.FC<HomeSectionProps> = ({ title, subtitle, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    {children}
  </View>
);

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  sectionSub: {
    color: colors.text.secondary,
    fontSize: 13,
    marginBottom: 16,
    marginTop: 2,
  },
});
