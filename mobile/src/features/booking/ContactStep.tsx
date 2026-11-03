import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '../../components/common/Card';
import { Input } from '../../components/common/Input';
import { colors } from '../../theme/colors';
import { formatTime12Hour } from '../../utils/time-utils';
import { BookingSummary, ContactDetails } from './bookingWizard';
import { StepNavigation } from './StepNavigation';
import { wizardStyles } from './wizardStyles';

interface ContactStepProps {
  summary: BookingSummary;
  contact: ContactDetails;
  onChangeContact: (field: keyof ContactDetails, value: string) => void;
  isSubmitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

const ReservationSummary: React.FC<{ summary: BookingSummary }> = ({ summary }) => (
  <Card style={styles.summaryCard} variant="goldBorder">
    <Text style={styles.summaryTitle}>Reservation Summary</Text>

    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Treatment:</Text>
      <Text style={styles.summaryVal}>{summary.service}</Text>
    </View>
    {summary.durationMinutes !== undefined && (
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Duration:</Text>
        <Text style={styles.summaryVal}>{summary.durationMinutes} mins</Text>
      </View>
    )}
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Barber:</Text>
      <Text style={styles.summaryVal}>{summary.barber}</Text>
    </View>
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>Date & Time:</Text>
      <Text style={styles.summaryVal}>
        {summary.date} @ {formatTime12Hour(summary.time)}
      </Text>
    </View>
    {summary.estimatedEnd ? (
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Est. End Time:</Text>
        <Text style={styles.estEndVal}>{formatTime12Hour(summary.estimatedEnd)}</Text>
      </View>
    ) : null}

    <View style={styles.divider} />

    <View style={[styles.summaryRow, styles.totalRow]}>
      <Text style={styles.totalLabel}>Total Est. Price:</Text>
      <Text style={styles.totalPrice}>${summary.total.toFixed(2)}</Text>
    </View>
  </Card>
);

/** Step 4: the reservation summary, the contact form and the booking request. */
export const ContactStep: React.FC<ContactStepProps> = ({
  summary,
  contact,
  onChangeContact,
  isSubmitting,
  onBack,
  onSubmit,
}) => (
  <View>
    <Text style={wizardStyles.stepTitle}>4. Contact Details & Summary</Text>

    <ReservationSummary summary={summary} />

    <Input
      label="Full Name *"
      placeholder="e.g. John Doe"
      value={contact.name}
      onChangeText={(value) => onChangeContact('name', value)}
      testID="customer-name-input"
    />

    <Input
      label="Email Address *"
      placeholder="john.doe@example.com"
      value={contact.email}
      onChangeText={(value) => onChangeContact('email', value)}
      keyboardType="email-address"
      autoCapitalize="none"
      testID="customer-email-input"
    />

    <Input
      label="Phone Number *"
      placeholder="+1 (555) 000-0000"
      value={contact.phone}
      onChangeText={(value) => onChangeContact('phone', value)}
      keyboardType="phone-pad"
      testID="customer-phone-input"
    />

    <StepNavigation
      onBack={onBack}
      onNext={onSubmit}
      nextTitle="Confirm & Request Booking"
      loading={isSubmitting}
    />
  </View>
);

const styles = StyleSheet.create({
  summaryCard: {
    marginBottom: 16,
  },
  summaryTitle: {
    color: colors.gold.main,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  summaryLabel: {
    color: colors.text.muted,
    fontSize: 13,
  },
  summaryVal: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  estEndVal: {
    color: colors.gold.main,
    fontSize: 13,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },
  totalRow: {
    marginTop: 4,
  },
  totalLabel: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  totalPrice: {
    color: colors.gold.bright,
    fontSize: 16,
    fontWeight: '800',
  },
});
