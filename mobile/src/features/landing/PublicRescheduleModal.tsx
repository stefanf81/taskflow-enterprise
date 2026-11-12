import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Modal } from '../../components/common/Modal';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { usePublicRescheduleAppointment } from '../../core/appointments/useAppointments';
import { ReschedulePicker, type RescheduleSelection } from '../../core/appointments/ReschedulePicker';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { useNow } from '../../core/shop/useNow';
import { colors } from '../../theme/colors';
import { formatTime12Hour } from '../../utils/time-utils';
import { getApiErrorMessage } from '../../utils/errors';
import { normalizePublicId, PUBLIC_ID_PLACEHOLDER } from './publicId';

interface PublicRescheduleModalProps {
  visible: boolean;
  initialPublicId?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

/**
 * Guest reschedule: the booking is proven with its reference ID and email (like the
 * cancellation), then moved to a slot its barber can take for its booked length (the server
 * answers for this booking, and checks again on save). It keeps its code, barber and service;
 * the shop confirms the new time again.
 */
export const PublicRescheduleModal: React.FC<PublicRescheduleModalProps> = ({
  visible,
  initialPublicId = '',
  onClose,
  onSuccess,
}) => {
  const [publicId, setPublicId] = useState(initialPublicId);
  const [email, setEmail] = useState('');
  // The booking the open picker moves, fixed when it opens so its availability and the save name
  // the same booking; editing either field closes the picker.
  const [target, setTarget] = useState<{ publicId: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { timeZone, rules } = useShopInfo();
  const now = useNow(60_000, timeZone);
  const rescheduleMutation = usePublicRescheduleAppointment();

  // Re-sync whenever the modal is (re)opened or the route's reference changes.
  useEffect(() => {
    if (visible) {
      setPublicId(initialPublicId);
      setEmail('');
      setTarget(null);
      setError(null);
    }
  }, [visible, initialPublicId]);

  const handleDismiss = () => {
    if (!rescheduleMutation.isPending) onClose();
  };

  const handleChooseTime = () => {
    if (!publicId.trim() || !email.trim()) {
      setError('Both Public Reference ID and Customer Email are required.');
      return;
    }
    setError(null);
    setTarget({ publicId: normalizePublicId(publicId), email: email.trim() });
  };

  const handleConfirm = (slot: RescheduleSelection) => {
    if (!target || rescheduleMutation.isPending) return;
    setError(null);
    rescheduleMutation.mutate(
      { ...target, ...slot },
      {
        onSuccess: (moved) => {
          onSuccess(
            `Booking moved to ${moved.bookingDate} at ${formatTime12Hour(moved.bookingTime)}. The shop will confirm it again.`,
          );
          onClose();
        },
        onError: (err) =>
          setError(
            getApiErrorMessage(
              err,
              'The booking could not be moved. Check your reference and email, or pick another time.',
            ),
          ),
      },
    );
  };

  return (
    <Modal visible={visible} onClose={handleDismiss} title="Reschedule Appointment">
      <View style={styles.container}>
        <Text style={styles.description}>
          Enter your Public Reference ID and the email address used during booking, then pick a new
          time. Your booking keeps its code, barber and service.
        </Text>

        <ErrorMessage message={error || ''} />

        <Input
          label="Public Reference ID"
          placeholder={PUBLIC_ID_PLACEHOLDER}
          value={publicId}
          onChangeText={(value) => {
            setPublicId(value);
            setTarget(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!rescheduleMutation.isPending}
        />

        <Input
          label="Customer Email"
          placeholder="your.email@example.com"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setTarget(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!rescheduleMutation.isPending}
        />

        {target ? (
          <ReschedulePicker
            now={now}
            rules={rules}
            publicId={target.publicId}
            email={target.email}
            saving={rescheduleMutation.isPending}
            onConfirm={handleConfirm}
            onClose={() => setTarget(null)}
          />
        ) : (
          <View style={styles.buttons}>
            <Button
              title="Back"
              variant="secondary"
              disabled={rescheduleMutation.isPending}
              onPress={handleDismiss}
              style={styles.halfBtn}
            />
            <Button
              title="Choose a new time"
              variant="primary"
              onPress={handleChooseTime}
              style={styles.halfBtn}
            />
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  description: {
    color: colors.text.secondary,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  halfBtn: {
    flex: 1,
  },
});
