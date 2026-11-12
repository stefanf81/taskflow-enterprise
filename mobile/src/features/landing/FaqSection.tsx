import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../theme/colors';
import { HomeSection } from './HomeSection';

const FAQS = [
  {
    q: 'Do I need an account to book an appointment?',
    a: 'No! You can book instantly as a guest. We will issue a unique Public Reference ID for tracking, cancellations, and reviews.',
  },
  {
    q: 'What is your cancellation policy?',
    a: 'You can cancel or reschedule online any time before your scheduled start time using your Public Reference ID and Email.',
  },
  {
    q: 'How does payment work?',
    a: 'Payment is collected in-salon upon service completion. All major cards and cash are accepted.',
  },
];

/** Accordion of common questions; one answer is open at a time. */
export const FaqSection: React.FC = () => {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  return (
    <HomeSection title="Frequently Asked Questions">
      {FAQS.map((f, idx) => {
        const isOpen = activeFaq === idx;
        return (
          <TouchableOpacity
            key={idx}
            style={styles.faqCard}
            onPress={() => setActiveFaq(isOpen ? null : idx)}
          >
            <View style={styles.faqHeader}>
              <Text style={styles.faqQ}>{f.q}</Text>
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.gold.main}
              />
            </View>
            {isOpen && <Text style={styles.faqA}>{f.a}</Text>}
          </TouchableOpacity>
        );
      })}
    </HomeSection>
  );
};

const styles = StyleSheet.create({
  faqCard: {
    backgroundColor: colors.obsidian.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQ: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  faqA: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 10,
    lineHeight: 18,
  },
});
