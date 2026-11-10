import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '../../components/common/Button';
import { colors } from '../../theme/colors';

interface HeroSectionProps {
  isAuthenticated: boolean;
  isAdmin: boolean;
  onBook: () => void;
  onSignIn: () => void;
  /** Opens the signed-in user's own area (admin or customer tabs). */
  onOpenAccount: () => void;
  /** Opens guest booking management (cancel / reschedule / review by booking code). */
  onManageBooking?: () => void;
}

/** Landing headline with the booking call to action and the sign-in / account button. */
export const HeroSection: React.FC<HeroSectionProps> = ({
  isAuthenticated,
  isAdmin,
  onBook,
  onSignIn,
  onOpenAccount,
  onManageBooking,
}) => (
  <View style={styles.heroContainer}>
    <View style={styles.squireBadge}>
      <Text style={styles.squireText}>SQUIRE INTEGRATED</Text>
    </View>
    <Text style={styles.heroTitle}>
      Luxury Barber{' '}
      <Text style={styles.heroGold}>Scheduler</Text>
    </Text>
    <Text style={styles.heroSubtitle}>
      Premium classic cuts, modern fades, hot towel straight-razor shaves, and beard sculpture
      managed with absolute scheduling precision.
    </Text>

    <View style={styles.heroButtons}>
      <Button
        testID="home-book-appointment-btn"
        title="Book Appointment"
        variant="primary"
        size="lg"
        icon={<Ionicons name="calendar" size={18} color={colors.obsidian.bg} />}
        onPress={onBook}
        style={styles.heroBtn}
      />
      {!isAuthenticated ? (
        <>
          <Button
            title="Sign In / Register"
            variant="outline"
            size="lg"
            onPress={onSignIn}
            style={styles.heroBtn}
          />
          {onManageBooking && (
            <Button
              title="Manage Booking"
              variant="secondary"
              size="md"
              onPress={onManageBooking}
              style={styles.heroBtn}
            />
          )}
        </>
      ) : (
        <Button
          title={isAdmin ? 'Admin Portal' : 'My Account'}
          variant="outline"
          size="lg"
          onPress={onOpenAccount}
          style={styles.heroBtn}
        />
      )}
    </View>
  </View>
);

const styles = StyleSheet.create({
  heroContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  squireBadge: {
    backgroundColor: 'rgba(197, 160, 89, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(197, 160, 89, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  squireText: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
    lineHeight: 34,
  },
  heroGold: {
    color: colors.gold.main,
  },
  heroSubtitle: {
    color: '#a1a1aa',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  heroButtons: {
    width: '100%',
    gap: 12,
  },
  heroBtn: {
    width: '100%',
  },
});
