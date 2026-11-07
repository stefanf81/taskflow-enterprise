import React, { useState } from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { appointmentsApi } from '../../core/appointments/appointments';
import { shareCalendarFile } from '../../core/calendar/shareCalendarFile';
import { AppointmentItem } from '../../types/api';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

interface ReceiptModalProps {
  visible: boolean;
  appointment: AppointmentItem | null;
  checkoutTotal?: number;
  onClose: () => void;
  onOpenPublicActions?: (publicId: string) => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  visible,
  appointment,
  checkoutTotal,
  onClose,
  onOpenPublicActions,
}) => {
  const [exportingCalendar, setExportingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const handleShare = async () => {
    if (!appointment) return;
    try {
      await Share.share({
        message: `TaskFlow Booking Confirmed!\nPublic ID: ${appointment.publicId}\nBarber: ${appointment.barberName}\nService: ${appointment.serviceType}\nDate: ${appointment.bookingDate} at ${appointment.bookingTime}`,
      });
    } catch {
      // ignore
    }
  };

  // The .ics goes to the share sheet as a file, so a calendar app can import the event.
  const handleExportCalendar = () => {
    if (!appointment || exportingCalendar) return;
    setExportingCalendar(true);
    setCalendarError(null);
    void appointmentsApi
      .exportPublicCalendar(appointment.publicId, appointment.customerEmail)
      .then(({ content, filename }) => shareCalendarFile(content, filename))
      .then(
        (shared) => {
          setExportingCalendar(false);
          if (!shared) setCalendarError('This device cannot share the calendar file.');
        },
        (err: unknown) => {
          setExportingCalendar(false);
          setCalendarError(
            getApiErrorMessage(err, 'The calendar file could not be created. Please try again.'),
          );
        },
      );
  };

  if (!appointment) return null;

  return (
    <Modal visible={visible} onClose={onClose} title="Booking Confirmation">
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <Ionicons name="checkmark-circle" size={56} color={colors.status.approved} />
        </View>

        <Text style={styles.title}>Appointment Reserved!</Text>
        <Text style={styles.subtitle}>
          Your booking has been received and is pending confirmation.
        </Text>

        <View style={styles.receiptCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Public Reference ID</Text>
            <Text style={styles.publicId}>{appointment.publicId}</Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Customer</Text>
            <Text style={styles.value}>{appointment.customerName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Service</Text>
            <Text style={styles.value}>{appointment.serviceType}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Barber</Text>
            <Text style={styles.value}>{appointment.barberName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date & Time</Text>
            <Text style={styles.value}>
              {appointment.bookingDate} @ {appointment.bookingTime}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Estimated Price</Text>
            <Text style={[styles.value, { color: colors.gold.bright, fontWeight: '800' }]}>
              ${(checkoutTotal ?? 0).toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <ErrorMessage message={calendarError || ''} />
          <Button
            title="Add to Calendar (.ics)"
            variant="outline"
            loading={exportingCalendar}
            icon={<Ionicons name="calendar-outline" size={16} color={colors.gold.main} />}
            onPress={handleExportCalendar}
            style={styles.btn}
          />
          <Button
            title="Share Booking Details"
            variant="outline"
            icon={<Ionicons name="share-outline" size={16} color={colors.gold.main} />}
            onPress={handleShare}
            style={styles.btn}
          />
          {onOpenPublicActions && (
            <Button
              title="Manage / Review Booking"
              variant="secondary"
              onPress={() => {
                onClose();
                onOpenPublicActions(appointment.publicId);
              }}
              style={styles.btn}
            />
          )}
          <Button title="Done" variant="primary" onPress={onClose} style={styles.btn} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 12,
  },
  title: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  receiptCard: {
    width: '100%',
    backgroundColor: colors.obsidian.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.gold.border,
    padding: 16,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.obsidian.border,
    marginVertical: 8,
  },
  label: {
    color: colors.text.muted,
    fontSize: 13,
  },
  value: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  publicId: {
    color: colors.gold.main,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  actions: {
    width: '100%',
    gap: 8,
  },
  btn: {
    width: '100%',
  },
});
