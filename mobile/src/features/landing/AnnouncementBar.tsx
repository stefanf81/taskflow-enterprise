import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated, useAnimatedValue } from 'react-native';
import { colors, semantic } from '../../theme/colors';
import { useShopInfo } from '../../core/shop/useShopInfo';

interface AnnouncementBarProps {
  /**
   * Whether the dot pulses. Bottom tabs stay mounted when another tab (or a pushed screen) is
   * shown, so the landing page passes its focus: a hidden loop still ran a native-driver
   * animation every frame.
   */
  active?: boolean;
}

/**
 * Promo strip at the top of the landing page, with a pulsing dot. The owner sets its text
 * (`announcement` in the shop info, `PUT /api/v1/catalog/announcement`); no text, no strip.
 */
export const AnnouncementBar: React.FC<AnnouncementBarProps> = ({ active = true }) => {
  // useAnimatedValue, not useRef(...).current: reading a ref during render makes React Compiler
  // skip the whole component.
  const pingAnim = useAnimatedValue(1);
  const { announcement } = useShopInfo();
  const visible = active && announcement !== '';

  // Animated ping effect for promo dot
  useEffect(() => {
    // Detox waits for the app to go idle; an endless animation keeps iOS busy forever.
    // Local E2E builds (the only ones with this flag) therefore keep the dot static.
    if (!visible || process.env.EXPO_PUBLIC_E2E_LOCAL_API === 'true') {
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pingAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pingAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      // Resume from full opacity, not from wherever the loop was stopped.
      pingAnim.setValue(1);
    };
  }, [pingAnim, visible]);

  if (announcement === '') return null;

  return (
    <View style={styles.announcementBar}>
      <Animated.View style={[styles.pingDot, { opacity: pingAnim }]} />
      <Text style={styles.announcementText}>{announcement}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // Bleeds into the screen's 16 px padding so the strip spans the full width.
  announcementBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semantic.raised,
    borderBottomWidth: 1,
    borderBottomColor: semantic.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 16,
    gap: 8,
  },
  pingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold.main,
  },
  announcementText: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
});
