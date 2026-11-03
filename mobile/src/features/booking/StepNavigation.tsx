import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Button } from '../../components/common/Button';

interface StepNavigationProps {
  onBack: () => void;
  onNext: () => void;
  nextTitle?: string;
  loading?: boolean;
}

/** The Back / forward button row under wizard steps 2-4. */
export const StepNavigation: React.FC<StepNavigationProps> = ({
  onBack,
  onNext,
  nextTitle = 'Continue',
  loading = false,
}) => (
  <View style={styles.navRow}>
    <Button title="Back" variant="secondary" onPress={onBack} style={styles.halfBtn} />
    <Button
      title={nextTitle}
      variant="primary"
      loading={loading}
      onPress={onNext}
      style={styles.halfBtn}
    />
  </View>
);

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  halfBtn: {
    flex: 1,
  },
});
