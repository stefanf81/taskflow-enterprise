import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { colors } from '../../theme/colors';

interface StylistProps {
  name: string;
  title: string;
  specialty: string;
  rating?: string;
  reviewsCount?: string;
  badge?: string;
  onSelect?: () => void;
  isSelected?: boolean;
}

export const StylistCard: React.FC<StylistProps> = ({
  name,
  title,
  specialty,
  rating = '5.0 ★',
  reviewsCount = 'New',
  badge,
  onSelect,
  isSelected = false,
}) => {
  return (
    <Card style={[styles.card, isSelected && styles.selectedCard]}>
      <View style={styles.avatarContainer}>
        <Ionicons name="person" size={28} color={colors.gold.main} />
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{name}</Text>
          {badge && (
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.specialty}>{specialty}</Text>

        <View style={styles.ratingRow}>
          <Ionicons name="star" size={14} color={colors.gold.bright} />
          <Text style={styles.ratingText}>{rating}</Text>
          <Text style={styles.reviewsText}>({reviewsCount})</Text>
        </View>
      </View>

      {onSelect && (
        <Button
          title={isSelected ? 'Selected' : 'Select'}
          variant={isSelected ? 'primary' : 'outline'}
          size="sm"
          onPress={onSelect}
          style={styles.button}
        />
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectedCard: {
    borderColor: colors.gold.main,
    backgroundColor: colors.obsidian.surface,
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.gold.dim,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  name: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  badgeContainer: {
    backgroundColor: colors.gold.dim,
    borderColor: colors.gold.border,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.gold.main,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  specialty: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  ratingText: {
    color: colors.gold.bright,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  reviewsText: {
    color: colors.text.muted,
    fontSize: 12,
    marginLeft: 4,
  },
  button: {
    minWidth: 80,
  },
});
