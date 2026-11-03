import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { BOOKING_STEPS, BookingStep } from './bookingWizard';

const STEP_LABELS: Record<BookingStep, string> = {
  1: '1. Select Treatment',
  2: '2. Choose Your Stylist',
  3: '3. Pick Date & Available Slot',
  4: '4. Customer Info & Submit',
};

interface BookingHeaderProps {
  step: BookingStep;
}

/** Wizard title, the step timeline and the current step's label. */
export const BookingHeader: React.FC<BookingHeaderProps> = ({ step }) => {
  const progress = ((step - 1) / (BOOKING_STEPS.length - 1)) * 100;
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Booking Assistant</Text>
      <Text style={styles.subtitle}>Follow our step-by-step assistant to secure your slot</Text>

      {/* Step Timeline */}
      <View style={styles.stepTimeline}>
        <View style={styles.timelineBg} />
        <View style={[styles.timelineProgress, { width: `${progress}%` }]} />
        <View style={styles.stepNodes}>
          {BOOKING_STEPS.map((s) => {
            const isActive = step === s;
            const isCompleted = step > s;
            return (
              <View
                key={s}
                style={[
                  styles.stepNode,
                  isActive && styles.stepNodeActive,
                  isCompleted && styles.stepNodeCompleted,
                ]}
              >
                <Text
                  style={[
                    styles.stepNodeText,
                    isActive && styles.stepNodeTextActive,
                    isCompleted && styles.stepNodeTextCompleted,
                  ]}
                >
                  {isCompleted ? '✓' : s}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Step label */}
      <Text style={styles.stepLabel}>{STEP_LABELS[step]}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: 16,
  },
  title: {
    color: colors.text.primary,
    fontSize: 22,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 2,
  },
  stepTimeline: {
    position: 'relative',
    height: 36,
    marginTop: 16,
    marginBottom: 8,
  },
  timelineBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 16,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 2,
  },
  timelineProgress: {
    position: 'absolute',
    left: 0,
    top: 16,
    height: 3,
    backgroundColor: colors.gold.dark,
    borderRadius: 2,
    zIndex: 1,
  },
  stepNodes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'relative',
    zIndex: 2,
  },
  stepNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    backgroundColor: colors.obsidian.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNodeActive: {
    borderColor: colors.gold.main,
    backgroundColor: colors.obsidian.card,
  },
  // Mirrors the web stepper: a gold fill with a dark check mark (gold on gold.dark was 1.7:1).
  stepNodeCompleted: {
    borderColor: colors.gold.main,
    backgroundColor: colors.gold.main,
  },
  stepNodeText: {
    color: colors.text.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  stepNodeTextActive: {
    color: colors.gold.main,
  },
  stepNodeTextCompleted: {
    color: colors.text.dark,
  },
  stepLabel: {
    textAlign: 'center',
    color: colors.gold.main,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
});
