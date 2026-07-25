import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { EmptyState } from '../components/common/EmptyState';
import { useCatalog } from '../hooks/useCatalog';
import { GuestTabParamList, RootStackParamList } from '../types/navigation';
import { colors } from '../theme/colors';

const CATEGORIES = ['all', 'HAIRCUTS', 'BEARD_TRIM', 'SHAVES', 'TREATMENTS'];

type CatalogNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Catalog'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const CatalogScreen: React.FC = () => {
  const navigation = useNavigation<CatalogNavProp>();
  const { data: services = [], isLoading } = useCatalog();

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredServices = services.filter((svc) => {
    const matchesCat = selectedCategory === 'all' || svc.category === selectedCategory;
    const matchesQuery =
      !searchQuery.trim() ||
      svc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      svc.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Service Catalog</Text>
          <Text style={styles.subtitle}>Explore our luxury salon offerings and pricing</Text>
        </View>

        {/* Search Input */}
        <Input
          placeholder="Search services..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          icon={<Ionicons name="search" size={18} color={colors.text.muted} />}
        />

        {/* Category Filter Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
        >
          {CATEGORIES.map((cat) => {
            const isSel = selectedCategory === cat;
            const displayLabel = cat === 'all' ? 'All Services' : cat.replace('_', ' ');

            return (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, isSel && styles.categoryChipSelected]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.categoryText, isSel && styles.categoryTextSelected]}>
                  {displayLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* List of Services */}
        {isLoading ? (
          <LoadingIndicator message="Fetching catalog..." />
        ) : filteredServices.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="No Services Found"
            message="Try adjusting your category filter or search query."
          />
        ) : (
          <FlatList
            data={filteredServices}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.serviceCard}>
                <View style={styles.serviceHeader}>
                  <View style={styles.titleContainer}>
                    <Text style={styles.serviceName}>{item.name}</Text>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.category.replace('_', ' ')}</Text>
                    </View>
                  </View>
                  <Text style={styles.price}>${item.price.toFixed(2)}</Text>
                </View>

                <Text style={styles.description}>{item.description}</Text>

                <View style={styles.footerRow}>
                  <View style={styles.durationRow}>
                    <Ionicons name="time-outline" size={14} color={colors.gold.main} />
                    <Text style={styles.durationText}>{item.durationMinutes} minutes</Text>
                  </View>

                  <Button
                    title="Book"
                    variant="outline"
                    size="sm"
                    onPress={() =>
                      navigation.navigate('Booking', { preselectedService: item.name })
                    }
                  />
                </View>
              </Card>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 2,
  },
  categoryScroll: {
    maxHeight: 40,
    marginBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.obsidian.card,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    marginRight: 8,
    justifyContent: 'center',
  },
  categoryChipSelected: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  categoryText: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  categoryTextSelected: {
    color: colors.obsidian.bg,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 24,
  },
  serviceCard: {
    marginBottom: 12,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleContainer: {
    flex: 1,
    paddingRight: 8,
  },
  serviceName: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: colors.gold.dim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  badgeText: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '700',
  },
  price: {
    color: colors.gold.bright,
    fontSize: 18,
    fontWeight: '800',
  },
  description: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.obsidian.border,
    paddingTop: 8,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationText: {
    color: colors.text.muted,
    fontSize: 12,
    marginLeft: 4,
  },
});
