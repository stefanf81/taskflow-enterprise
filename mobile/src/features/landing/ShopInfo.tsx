import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { openingHoursRows } from '@taskflow/domain';
import { useShopInfo } from '../../core/shop/useShopInfo';

// Shop details under the grooming menu: the opening hours (from the shop info), retail products
// and a testimonial.

/** Weekly opening hours (hand-written for now; meant to come from the backend's shop info). */
/** The week's hours from the barbers' schedules (server defaults until the shop info loads). */
export const OperatingHours: React.FC = () => {
  const { rules } = useShopInfo();
  return (
    <View style={styles.hoursCard}>
      <Text style={styles.cardLabel}>Operating Hours</Text>
      {openingHoursRows(rules).map((row) =>
        row.hours ? (
          <View key={row.days} style={styles.row}>
            <Text style={styles.hoursDay}>{row.days}</Text>
            <Text style={styles.hoursTime}>{row.hours}</Text>
          </View>
        ) : (
          <View key={row.days} style={styles.row}>
            <Text style={[styles.hoursDay, styles.closedDay]}>{row.days}</Text>
            <Text style={[styles.hoursTime, styles.closedDay]}>CLOSED</Text>
          </View>
        ),
      )}
    </View>
  );
};

export const ArtisanalProducts: React.FC = () => (
  <View style={styles.productsCard}>
    <Text style={styles.cardLabel}>Artisanal Products</Text>
    <View style={styles.row}>
      <Text style={styles.productName}>Styling Fiber Clay (100ml)</Text>
      <Text style={styles.productPrice}>$24.00</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.productName}>Sandalwood Beard Balm (60ml)</Text>
      <Text style={styles.productPrice}>$19.00</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.productName}>Straight Razor Shave Cream (150ml)</Text>
      <Text style={styles.productPrice}>$22.00</Text>
    </View>
  </View>
);

export const ClientTestimonial: React.FC = () => (
  <View style={styles.testimonialCard}>
    <Text style={styles.cardLabel}>Client Social Proof</Text>
    <Text style={styles.testimonialText}>
      "The best skin fade I have ever had. Sara is incredibly meticulous and the royal
      steam towel shave is pure heaven. I will never go anywhere else!"
    </Text>
    <Text style={styles.testimonialAuthor}>— Liam K. (5/5 ★)</Text>
  </View>
);

const styles = StyleSheet.create({
  cardLabel: {
    color: colors.text.primary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },

  // Operating Hours
  hoursCard: {
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(24,24,27,0.5)',
    padding: 16,
  },
  hoursDay: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  hoursTime: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  closedDay: {
    color: '#f87171',
    fontWeight: '700',
  },

  // Products
  productsCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(229, 193, 133, 0.05)',
    padding: 16,
  },
  productName: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  productPrice: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '700',
  },

  // Testimonial
  testimonialCard: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(24,24,27,0.3)',
    padding: 16,
  },
  testimonialText: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  testimonialAuthor: {
    color: '#d4d4d8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'right',
    marginTop: 10,
  },
});
