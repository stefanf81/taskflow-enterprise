import { StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

/** Styles several wizard steps share: the step title, field labels and the selectable rows. */
export const wizardStyles = StyleSheet.create({
  stepTitle: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.obsidian.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    padding: 14,
    marginBottom: 8,
  },
  optionSelected: {
    borderColor: colors.gold.main,
    backgroundColor: colors.obsidian.surface,
  },
  optionTitle: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
});
