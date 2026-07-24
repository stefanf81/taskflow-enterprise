import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { PublicCancelModal } from '../components/booking/PublicCancelModal';
import { PublicReviewModal } from '../components/booking/PublicReviewModal';
import { RootStackParamList } from '../types/navigation';
import { colors } from '../theme/colors';

type RouteProps = RouteProp<RootStackParamList, 'PublicActions'>;

export const PublicActionsScreen: React.FC = () => {
  const route = useRoute<RouteProps>();
  const initialPublicId = route.params?.publicId || '';

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Manage Public Booking</Text>
          <Text style={styles.subtitle}>
            Self-service options for guest bookings using your Public Reference ID
          </Text>
        </View>

        {toastMessage && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        )}

        {/* Action 1: Cancel Booking */}
        <Card style={styles.actionCard}>
          <Text style={styles.actionTitle}>Cancel Appointment</Text>
          <Text style={styles.actionDesc}>
            Need to reschedule or cancel your visit? Provide your Public Reference ID and Email to remove your booking.
          </Text>
          <Button
            title="Cancel an Appointment"
            variant="danger"
            onPress={() => setShowCancelModal(true)}
            style={styles.actionBtn}
          />
        </Card>

        {/* Action 2: Leave a Review */}
        <Card style={styles.actionCard}>
          <Text style={styles.actionTitle}>Leave a Review & Rating</Text>
          <Text style={styles.actionDesc}>
            Completed your service? Rate your barber and help us maintain our 5-star salon standards.
          </Text>
          <Button
            title="Write Barber Review"
            variant="primary"
            onPress={() => setShowReviewModal(true)}
            style={styles.actionBtn}
          />
        </Card>
      </ScrollView>

      {/* Modals */}
      <PublicCancelModal
        visible={showCancelModal}
        initialPublicId={initialPublicId}
        onClose={() => setShowCancelModal(false)}
        onSuccess={() => showToast('Appointment cancelled successfully.')}
      />

      <PublicReviewModal
        visible={showReviewModal}
        initialPublicId={initialPublicId}
        onClose={() => setShowReviewModal(false)}
        onSuccess={() => showToast('Thank you! Your review has been published.')}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  toast: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  toastText: {
    color: colors.status.approved,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionCard: {
    marginBottom: 16,
  },
  actionTitle: {
    color: colors.gold.main,
    fontSize: 17,
    fontWeight: '700',
  },
  actionDesc: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },
  actionBtn: {
    width: '100%',
  },
});
