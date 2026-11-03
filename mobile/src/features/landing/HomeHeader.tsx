import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../theme/colors';

interface HomeHeaderProps {
  /** Shown to guests only; opens the sign-in screen. */
  onOwnerPortal?: () => void;
}

/** Brand row: logo, "Shop Open" badge and, for guests, the owner sign-in link. */
export const HomeHeader: React.FC<HomeHeaderProps> = ({ onOwnerPortal }) => (
  <View style={styles.navHeader}>
    <View style={styles.navBrand}>
      <Ionicons name="checkmark-circle" size={24} color={colors.gold.main} />
      <Text style={styles.navTitle}>
        TaskFlow <Text style={styles.navPro}>pro</Text>
      </Text>
    </View>
    <View style={styles.navRight}>
      <View style={styles.shopBadge}>
        <View style={styles.shopDot} />
        <Text style={styles.shopText}>Shop Open</Text>
      </View>
      {onOwnerPortal && (
        <TouchableOpacity onPress={onOwnerPortal}>
          <Text style={styles.ownerLink}>Owner Portal</Text>
        </TouchableOpacity>
      )}
    </View>
  </View>
);

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navTitle: {
    color: '#f4f4f5',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  navPro: {
    color: colors.gold.main,
    fontWeight: '300',
    fontSize: 14,
    textTransform: 'lowercase',
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shopBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  shopDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
  },
  shopText: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '700',
  },
  ownerLink: {
    color: '#a1a1aa',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
