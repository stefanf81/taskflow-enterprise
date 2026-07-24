import React from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { AppointmentItem } from '../../types/api';
import { colors } from '../../theme/colors';

interface ReceiptModalProps {
  visible: boolean;
  appointment: AppointmentItem | null;
  onClose: () => void;
  onOpenPublicActions?: (publicId: string) => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  visible,
  appointment,
  onClose,
  onOpenPublicActions,
}) => {
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
        </View>

        <View style={styles.actions}>
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
