import React from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Button } from '../../components/common/Button';
import { colors } from '../../theme/colors';
import { DEFAULT_TIME_SLOTS, UpcomingDay } from '../../utils/time-utils';
import { getApiErrorMessage } from '../../utils/errors';
import { TimeSlotPicker } from './TimeSlotPicker';
import { StepNavigation } from './StepNavigation';
import { SlotAvailability } from './bookingWizard';
import { wizardStyles } from './wizardStyles';

interface DateTimeStepProps {
  days: readonly UpcomingDay[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  selectedTime: string;
  onSelectTime: (time: string) => void;
  /** Slots of the selected day that already started. */
  pastSlots: readonly string[];
  noSlotsLeft: boolean;
  availability: SlotAvailability;
  availabilityError: unknown;
  onRetryAvailability: () => void;
  onBack: () => void;
  onContinue: () => void;
}

/** Step 3: pick an operating day and a free slot. */
export const DateTimeStep: React.FC<DateTimeStepProps> = ({
  days,
  selectedDate,
  onSelectDate,
  selectedTime,
  onSelectTime,
  pastSlots,
  noSlotsLeft,
  availability,
  availabilityError,
  onRetryAvailability,
  onBack,
  onContinue,
}) => (
  <View>
    <Text style={wizardStyles.stepTitle}>3. Pick Date & Available Slot</Text>

    <Text style={wizardStyles.label}>Select Operating Day</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.daysScroll}>
      {days.map((d) => {
        const isSel = selectedDate === d.dateStr;
        return (
          <TouchableOpacity
            key={d.dateStr}
            testID={`booking-day-${d.dateStr}`}
            style={[styles.dayCard, isSel && styles.daySelected]}
            onPress={() => onSelectDate(d.dateStr)}
          >
            <Text style={[styles.dayName, isSel && styles.dayTextSel]}>{d.dayName}</Text>
            <Text style={[styles.dayNum, isSel && styles.dayTextSel]}>{d.dayNum}</Text>
            <Text style={[styles.monthName, isSel && styles.dayTextSel]}>{d.monthName}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>

    <Text style={[wizardStyles.label, styles.slotsLabel]}>Available Time Slots</Text>
    {availability.isChecking ? (
      <View style={styles.checkingContainer}>
        <ActivityIndicator size="large" color={colors.gold.main} />
        <Text style={styles.checkingText}>Checking slot availability...</Text>
      </View>
    ) : availability.isFailed ? (
      <View style={styles.noDatePrompt}>
        <Text style={styles.noDateText}>
          {getApiErrorMessage(availabilityError, 'Could not check availability.')}
        </Text>
        <Button
          title="Retry"
          variant="secondary"
          size="sm"
          onPress={onRetryAvailability}
          style={styles.retryBtn}
        />
      </View>
    ) : selectedDate ? (
      <>
        <TimeSlotPicker
          slots={DEFAULT_TIME_SLOTS}
          selectedSlot={selectedTime}
          busySlots={availability.busySlots}
          pastSlots={pastSlots}
          onSelectSlot={onSelectTime}
        />
        {noSlotsLeft && (
          <Text style={styles.noDateText}>
            No more slots are available on this day. Please pick another date.
          </Text>
        )}
      </>
    ) : (
      <View style={styles.noDatePrompt}>
        <Text style={styles.noDateText}>📅 Select an upcoming date above to view available time slots</Text>
      </View>
    )}

    <StepNavigation onBack={onBack} onNext={onContinue} />
  </View>
);

const styles = StyleSheet.create({
  // Days
  daysScroll: {
    marginBottom: 12,
  },
  dayCard: {
    width: 68,
    height: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    backgroundColor: colors.obsidian.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  daySelected: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  dayName: {
    color: colors.text.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  dayNum: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '800',
    marginVertical: 2,
  },
  monthName: {
    color: colors.text.muted,
    fontSize: 10,
  },
  dayTextSel: {
    color: colors.obsidian.bg,
  },
  slotsLabel: {
    marginTop: 20,
  },
  // Checking indicator
  checkingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  checkingText: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  noDatePrompt: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  noDateText: {
    color: colors.text.muted,
    fontSize: 13,
  },
  retryBtn: {
    marginTop: 12,
  },
});
