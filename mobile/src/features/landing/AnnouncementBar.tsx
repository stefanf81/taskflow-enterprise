import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated, useAnimatedValue } from 'react-native';
import { colors } from '../../theme/colors';

interface AnnouncementBarProps {
  /**
   * Whether the dot pulses. Bottom tabs stay mounted when another tab (or a pushed screen) is
   * shown, so the landing page passes its focus: a hidden loop still ran a native-driver
   * animation every frame.
   */
  active?: boolean;
}

/** Promo strip at the top of the landing page, with a pulsing dot. */
export const AnnouncementBar: React.FC<AnnouncementBarProps> = ({ active = true }) => {
  // useAnimatedValue, not useRef(...).current: reading a ref during render makes React Compiler
  // skip the whole component.
  const pingAnim = useAnimatedValue(1);

  // Animated ping effect for promo dot
  useEffect(() => {
    // Detox waits for the app to go idle; an endless animation keeps iOS busy forever.
    // Local E2E builds (the only ones with this flag) therefore keep the dot static.
    if (!active || process.env.EXPO_PUBLIC_E2E_LOCAL_API === 'true') {
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
  }, [pingAnim, active]);

  return (
    <View style={styles.announcementBar}>
      <Animated.View style={[styles.pingDot, { opacity: pingAnim }]} />
      <Text style={styles.announcementText}>
        Special Highlight: Book 'The Executive Package' today and get 15% off any premium hair
        styling clay!
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // Bleeds into the screen's 16 px padding so the strip spans the full width.
  announcementBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181b',
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
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
