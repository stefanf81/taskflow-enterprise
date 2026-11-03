import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../theme/colors';
import { StepNavigation } from './StepNavigation';
import { wizardStyles } from './wizardStyles';

interface StylistStepProps {
  /** The No-Preference sentinel first, then the live roster. */
  barberNames: readonly string[];
  selectedBarber: string;
  onSelectBarber: (barberName: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

/** Step 2: pick a barber or "No Preference". */
export const StylistStep: React.FC<StylistStepProps> = ({
  barberNames,
  selectedBarber,
  onSelectBarber,
  onBack,
  onContinue,
}) => (
  <View>
    <Text style={wizardStyles.stepTitle}>2. Choose Your Stylist</Text>

    <Text style={wizardStyles.label}>Select Barber</Text>
    {barberNames.map((b) => {
      const isSel = selectedBarber === b;
      return (
        <TouchableOpacity
          key={b}
          style={[wizardStyles.optionCard, isSel && wizardStyles.optionSelected]}
          onPress={() => onSelectBarber(b)}
        >
          <Ionicons
            name="person"
            size={20}
            color={isSel ? colors.gold.main : colors.text.muted}
            style={styles.barberIcon}
          />
          <Text style={[wizardStyles.optionTitle, styles.barberName]}>{b}</Text>
          {isSel && <Ionicons name="checkmark-circle" size={20} color={colors.gold.main} />}
        </TouchableOpacity>
      );
    })}

    <StepNavigation onBack={onBack} onNext={onContinue} />
  </View>
);

const styles = StyleSheet.create({
  barberIcon: {
    marginRight: 10,
  },
  barberName: {
    flex: 1,
  },
});
