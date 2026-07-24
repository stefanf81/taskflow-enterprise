import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { colors } from '../../theme/colors';

export interface LookbookItem {
  id: string;
  title: string;
  category: string;
  barber: string;
  description: string;
}

const LOOKBOOK_DATA: LookbookItem[] = [
  {
    id: '1',
    title: 'Executive Pompadour & Beard Trim',
    category: 'Haircuts',
    barber: 'Alex the Barber',
    description: 'Precision scissor work with textured volume and sharp razor-defined beard lines.',
  },
  {
    id: '2',
    title: 'Zero Skin Fade & Textured Crop',
    category: 'Haircuts',
    barber: 'Sara the Stylist',
    description: 'High skin fade transitioning seamlessly into a blunt forward-fringe texture.',
  },
  {
    id: '3',
    title: 'Hot Towel Royal Razor Shave',
    category: 'Shaves',
    barber: 'Marcus Master Blade',
    description: 'Traditional 3-stage hot towel wrap followed by straight razor smooth finish.',
  },
  {
    id: '4',
    title: 'Classic Taper Fade & Lineup',
    category: 'Haircuts',
    barber: 'Alex the Barber',
    description: 'Subtle temple taper fade with crisp edge-up for a clean professional aesthetic.',
  },
];

interface LookbookGalleryProps {
  onSelectStyle?: (item: LookbookItem) => void;
}

export const LookbookGallery: React.FC<LookbookGalleryProps> = ({ onSelectStyle }) => {
  return (
    <View style={styles.container}>
      <FlatList
        data={LOOKBOOK_DATA}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <Card style={styles.card} variant="goldBorder">
            <View style={styles.imagePlaceholder}>
              <Ionicons name="cut" size={36} color={colors.gold.main} />
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText}>{item.category}</Text>
              </View>
            </View>

            <View style={styles.content}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.barber}>Crafted by {item.barber}</Text>
              <Text style={styles.description}>{item.description}</Text>

              {onSelectStyle && (
                <Button
                  title="Book This Look"
                  variant="outline"
                  size="sm"
                  style={styles.bookBtn}
                  onPress={() => onSelectStyle(item)}
                />
              )}
            </View>
          </Card>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  card: {
    marginBottom: 16,
    padding: 0,
    overflow: 'hidden',
  },
  imagePlaceholder: {
    height: 120,
    backgroundColor: colors.obsidian.surface,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: colors.obsidian.border,
  },
  categoryBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: colors.gold.main,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  categoryText: {
    color: colors.obsidian.bg,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  content: {
    padding: 16,
  },
  title: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  barber: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 6,
  },
  description: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  bookBtn: {
    marginTop: 12,
  },
});
