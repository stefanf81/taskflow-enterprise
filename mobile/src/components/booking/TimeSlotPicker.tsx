import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface TimeSlotPickerProps {
  slots: string[];
  selectedSlot: string;
  busySlots?: string[];
  onSelectSlot: (slot: string) => void;
}

export const TimeSlotPicker: React.FC<TimeSlotPickerProps> = ({
  slots,
  selectedSlot,
  busySlots = [],
  onSelectSlot,
}) => {
  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const isBusy = busySlots.includes(slot);
        const isSelected = selectedSlot === slot;

        return (
          <TouchableOpacity
            key={slot}
            disabled={isBusy}
            onPress={() => onSelectSlot(slot)}
            style={[
              styles.slot,
              isSelected && styles.selectedSlot,
              isBusy && styles.busySlot,
            ]}
          >
            <Text
              style={[
                styles.slotText,
                isSelected && styles.selectedSlotText,
                isBusy && styles.busySlotText,
              ]}
            >
              {slot}
            </Text>
            {isBusy && <Text style={styles.busyLabel}>Booked</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 8,
  },
  slot: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    backgroundColor: colors.obsidian.inputBg,
    alignItems: 'center',
    flexBasis: '22%',
  },
  selectedSlot: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  busySlot: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
    opacity: 0.6,
  },
  slotText: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  selectedSlotText: {
    color: colors.obsidian.bg,
  },
  busySlotText: {
    color: colors.status.denied,
    textDecorationLine: 'line-through',
  },
  busyLabel: {
    color: colors.status.denied,
    fontSize: 9,
    marginTop: 2,
  },
});
