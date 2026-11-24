import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isOpenAt } from '@taskflow/domain';
import { useNow } from '../../core/shop/useNow';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { colors, semantic, withAlpha } from '../../theme/colors';

interface HomeHeaderProps {
  /** Shown to guests only; opens the sign-in screen (customers and the owner alike). */
  onSignIn?: () => void;
}

/** Brand row: logo, live "Shop Open" / "Closed" badge and, for guests, the sign-in link. */
export const HomeHeader: React.FC<HomeHeaderProps> = ({ onSignIn }) => {
  const { timeZone, rules, loaded } = useShopInfo();
  const now = useNow(60_000, timeZone);
  const openNow = loaded ? isOpenAt(now, rules) : null;

  return (
    <View style={styles.navHeader}>
      <View style={styles.navBrand}>
        <Ionicons name="checkmark-circle" size={24} color={colors.gold.main} />
        <Text style={styles.navTitle}>
          TaskFlow <Text style={styles.navPro}>pro</Text>
        </Text>
      </View>
      <View style={styles.navRight}>
        {openNow !== null && (
          <View style={[styles.shopBadge, !openNow && styles.shopBadgeClosed]}>
            <View style={[styles.shopDot, !openNow && styles.shopDotClosed]} />
            <Text style={[styles.shopText, !openNow && styles.shopTextClosed]}>
              {openNow ? 'Shop Open' : 'Closed'}
            </Text>
          </View>
        )}
        {onSignIn && (
          <TouchableOpacity onPress={onSignIn} accessibilityRole="button">
            <Text style={styles.ownerLink}>Sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(semantic['fg-strong'], 0.1),
    marginBottom: 16,
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navTitle: {
    color: semantic.fg,
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
    backgroundColor: withAlpha(semantic.success, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(semantic.success, 0.2),
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  shopDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: semantic.success,
  },
  shopText: {
    color: semantic.success,
    fontSize: 10,
    fontWeight: '700',
  },
  shopBadgeClosed: {
    backgroundColor: withAlpha(semantic['fg-muted'], 0.1),
    borderColor: withAlpha(semantic['fg-muted'], 0.2),
  },
  shopDotClosed: {
    backgroundColor: semantic['fg-muted'],
  },
  shopTextClosed: {
    color: semantic['fg-muted'],
  },
  ownerLink: {
    color: semantic['fg-muted'],
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
