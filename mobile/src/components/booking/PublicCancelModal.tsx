import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Modal } from '../common/Modal';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { ErrorMessage } from '../common/ErrorMessage';
import { usePublicCancelAppointment } from '../../hooks/useAppointments';
import { colors } from '../../theme/colors';

interface PublicCancelModalProps {
  visible: boolean;
  initialPublicId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const PublicCancelModal: React.FC<PublicCancelModalProps> = ({
  visible,
  initialPublicId = '',
  onClose,
  onSuccess,
}) => {
  const [publicId, setPublicId] = useState(initialPublicId);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancelMutation = usePublicCancelAppointment();

  const handleCancel = async () => {
    if (!publicId.trim() || !email.trim()) {
      setError('Both Public Reference ID and Customer Email are required.');
      return;
    }

    setError(null);
    try {
      await cancelMutation.mutateAsync({ publicId: publicId.trim(), email: email.trim() });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : err instanceof Error
            ? err.message
            : 'Failed to cancel appointment.';
      setError(message || 'Failed to cancel appointment.');
    }
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Cancel Appointment">
      <View style={styles.container}>
        <Text style={styles.description}>
          Enter your Public Reference ID and the email address used during booking to cancel your appointment.
        </Text>

        <ErrorMessage message={error || ''} />

        <Input
          label="Public Reference ID"
          placeholder="e.g. TF-9823-8A2F"
          value={publicId}
          onChangeText={setPublicId}
          autoCapitalize="characters"
        />

        <Input
          label="Customer Email"
          placeholder="your.email@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <View style={styles.buttons}>
          <Button title="Back" variant="secondary" onPress={onClose} style={styles.halfBtn} />
          <Button
            title="Cancel Appointment"
            variant="danger"
            loading={cancelMutation.isPending}
            onPress={handleCancel}
            style={styles.halfBtn}
          />
        </View>
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
