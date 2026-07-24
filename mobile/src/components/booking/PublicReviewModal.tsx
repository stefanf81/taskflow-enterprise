import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../common/Modal';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { ErrorMessage } from '../common/ErrorMessage';
import { useSubmitReview } from '../../hooks/useReviews';
import { colors } from '../../theme/colors';

interface PublicReviewModalProps {
  visible: boolean;
  initialPublicId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const PublicReviewModal: React.FC<PublicReviewModalProps> = ({
  visible,
  initialPublicId = '',
  onClose,
  onSuccess,
}) => {
  const [publicId, setPublicId] = useState(initialPublicId);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reviewMutation = useSubmitReview();

  const handleSubmit = async () => {
    if (!publicId.trim()) {
      setError('Public Reference ID is required.');
      return;
    }

    setError(null);
    try {
      await reviewMutation.mutateAsync({
        publicId: publicId.trim(),
        data: { rating, comment: comment.trim() },
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : err instanceof Error
            ? err.message
            : 'Failed to submit review.';
      setError(message || 'Failed to submit review.');
    }
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Leave a Review">
      <View style={styles.container}>
        <Text style={styles.description}>
          Share your experience with TaskFlow. Please provide your Public Reference ID from your booking.
        </Text>

        <ErrorMessage message={error || ''} />

        <Input
          label="Public Reference ID"
          placeholder="e.g. TF-9823-8A2F"
          value={publicId}
          onChangeText={setPublicId}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Rating</Text>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((star) => (
            <TouchableOpacity key={star} onPress={() => setRating(star)} style={styles.starTouch}>
              <Ionicons
                name={star <= rating ? 'star' : 'star-outline'}
                size={32}
                color={star <= rating ? colors.gold.bright : colors.text.muted}
              />
            </TouchableOpacity>
          ))}
        </View>

        <Input
          label="Comment / Feedback"
          placeholder="Tell us how your hair style turned out..."
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={3}
          style={styles.commentInput}
        />

        <View style={styles.buttons}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.halfBtn} />
          <Button
            title="Submit Review"
            variant="primary"
            loading={reviewMutation.isPending}
            onPress={handleSubmit}
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
  label: {
    color: colors.text.secondary,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  starRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  starTouch: {
    padding: 4,
  },
  commentInput: {
    height: 80,
    textAlignVertical: 'top',
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
