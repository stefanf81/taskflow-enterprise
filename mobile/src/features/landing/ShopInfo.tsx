import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { formatRating, openingHoursRows, summarizeShopRatings } from '@taskflow/domain';
import { useBarberRatings } from './useReviews';
import { useShopInfo } from '../../core/shop/useShopInfo';

// Shop details under the grooming menu: the opening hours (from the shop info), retail products
// and the client ratings.

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

/**
 * The shop's real rating across every barber's reviews (`/reviews/public/barber-ratings`), in place
 * of a hand-picked quote. Same summary as the web landing page (`summarizeShopRatings`).
 */
export const ClientRatings: React.FC = () => {
  const { data: ratings = [], isLoading, isError } = useBarberRatings();
  const summary = summarizeShopRatings(ratings);

  let body: React.ReactNode = null;
  if (summary) {
    body = (
      <>
        <View
          style={styles.ratingRow}
          accessible
          accessibilityLabel={`${formatRating(summary.averageRating)} out of 5 from ${summary.reviewCount} ${summary.reviewCount === 1 ? 'review' : 'reviews'}`}
        >
          <Text style={styles.ratingValue}>{formatRating(summary.averageRating)}</Text>
          <Text style={styles.ratingStar}>★</Text>
          <Text style={styles.ratingCount}>
            from {summary.reviewCount} {summary.reviewCount === 1 ? 'review' : 'reviews'}
          </Text>
        </View>
        <Text style={styles.topRated}>
          Top rated: <Text style={styles.topRatedName}>{summary.topBarber.barberName}</Text> ·{' '}
          {formatRating(summary.topBarber.averageRating)} ★
        </Text>
      </>
    );
  } else if (isError) {
    body = <Text style={styles.ratingNote}>Ratings are unavailable right now.</Text>;
  } else if (!isLoading) {
    body = (
      <Text style={styles.ratingNote}>
        No reviews yet. After your visit you can rate your barber.
      </Text>
    );
  }

  return (
    <View style={styles.ratingsCard} testID="client-ratings">
      <Text style={styles.cardLabel}>Client Ratings</Text>
      <View style={styles.ratingsBody}>{body}</View>
    </View>
  );
};

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

  // Client ratings
  ratingsCard: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(24,24,27,0.3)',
    padding: 16,
  },
  // Holds its height while the ratings load, so the sections below do not jump.
  ratingsBody: {
    minHeight: 48,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  ratingValue: {
    color: colors.gold.main,
    fontSize: 24,
    fontWeight: '900',
  },
  ratingStar: {
    color: colors.gold.main,
    fontSize: 14,
  },
  ratingCount: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  topRated: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 8,
  },
  topRatedName: {
    color: '#e4e4e7',
    fontWeight: '600',
  },
  ratingNote: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
  },
});
