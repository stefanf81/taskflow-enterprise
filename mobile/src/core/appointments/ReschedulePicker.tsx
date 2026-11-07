import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import {
  DEFAULT_TIME_SLOTS,
  formatTime12Hour,
  openSlotsOn,
  parseLocalDate,
  rescheduleDates,
  type ShopRules,
} from '@taskflow/domain';
import { Button } from '../../components/common/Button';
import { useRescheduleAvailability } from './useAppointments';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

export interface RescheduleSelection {
  bookingDate: string;
  bookingTime: string;
}

interface ReschedulePickerProps {
  /** The shop's wall clock (see useNow) and rules (see useShopInfo). */
  now: Date;
  rules: ShopRules;
  /** The booking to move; a guest also passes the email it was booked with. */
  publicId: string;
  email?: string | null;
  /** Where the booking is now: preselected, and no move to itself. */
  currentDate?: string;
  currentTime?: string;
  saving?: boolean;
  onConfirm: (selection: RescheduleSelection) => void;
  onClose: () => void;
}

function shortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Picks a new date and time for an existing booking with the same rules as the web picker
 * (`@taskflow/domain`): the shop's open days inside the booking window, and the slots of the
 * chosen day within its opening hours that have not started and that the server offers for this
 * booking (its own barber and booked length, the booking itself not counted, so a service renamed
 * or retired since does not matter). Shared by the customer portal and the guest actions.
 */
export const ReschedulePicker: React.FC<ReschedulePickerProps> = ({
  now,
  rules,
  publicId,
  email = null,
  currentDate = '',
  currentTime = '',
  saving = false,
  onConfirm,
  onClose,
}) => {
  const dates = rescheduleDates(now, rules, DEFAULT_TIME_SLOTS);
  const [chosenDate, setChosenDate] = useState(() =>
    dates.includes(currentDate) ? currentDate : (dates[0] ?? ''),
  );
  const [chosenTime, setChosenTime] = useState('');
  // A day that dropped out of the window (time moved on) falls back to the first open one.
  const selectedDate = dates.includes(chosenDate) ? chosenDate : (dates[0] ?? '');

  const busy = useRescheduleAvailability(publicId, selectedDate, email);
  const current = currentTime.slice(0, 5);
  const slots = openSlotsOn(selectedDate, now, rules, DEFAULT_TIME_SLOTS, busy.data ?? []).filter(
    (slot) => !(selectedDate === currentDate && slot === current),
  );
  const selectedTime = slots.includes(chosenTime) ? chosenTime : '';
  // The server's reason (a wrong code or email, a booking that can no longer move) or a fallback.
  const slotsError = busy.isError
    ? getApiErrorMessage(busy.error, 'Availability could not be loaded.')
    : null;

  return (
    <View style={styles.container} accessibilityLabel="Choose a new date and time">
      <Text style={styles.label}>New date</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {dates.length === 0 && <Text style={styles.hint}>No open days in the booking window.</Text>}
        {dates.map((date) => {
          const selected = date === selectedDate;
          return (
            <TouchableOpacity
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => {
                setChosenDate(date);
                setChosenTime('');
              }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {shortDate(date)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>New time</Text>
      {busy.isLoading ? (
        <Text style={styles.hint}>Checking availability…</Text>
      ) : slotsError ? (
        <View style={styles.row}>
          <Text style={styles.error} accessibilityRole="alert">
            {slotsError}
          </Text>
          <Button title="Retry" variant="secondary" size="sm" onPress={() => void busy.refetch()} />
        </View>
      ) : (
        <View style={styles.wrap}>
          {slots.length === 0 && <Text style={styles.hint}>No free time on this day.</Text>}
          {slots.map((slot) => {
            const selected = slot === selectedTime;
            return (
              <TouchableOpacity
                key={slot}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setChosenTime(slot)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {formatTime12Hour(slot)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <Button
          title="Save new time"
          variant="primary"
          size="sm"
          loading={saving}
          disabled={saving || !selectedDate || !selectedTime}
          onPress={() => onConfirm({ bookingDate: selectedDate, bookingTime: selectedTime })}
          style={styles.action}
        />
        <Button
          title="Close"
          variant="secondary"
          size="sm"
          disabled={saving}
          onPress={onClose}
          style={styles.action}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    backgroundColor: colors.obsidian.inputBg,
  },
  label: {
    color: colors.text.secondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  chipSelected: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  chipText: {
    color: colors.text.primary,
    fontSize: 12,
  },
  chipTextSelected: {
    color: colors.obsidian.bg,
    fontWeight: '700',
  },
  hint: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 4,
  },
  error: {
    color: colors.status.denied,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  action: {
    flex: 1,
  },
});
