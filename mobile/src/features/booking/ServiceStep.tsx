import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '../../components/common/Button';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { ServiceItem } from '../../types/api';
import { colors } from '../../theme/colors';
import { filterServices } from './bookingWizard';
import { wizardStyles } from './wizardStyles';

// Backend category values (V5__create_service_catalog.sql): hair | beard | combo
const CATEGORIES = ['all', 'hair', 'beard', 'combo'];

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  hair: 'Haircuts',
  beard: 'Beards & Shaves',
  combo: 'Combos',
};

interface ServiceStepProps {
  services: readonly ServiceItem[];
  /** The catalog request is in flight and nothing is cached yet. */
  isLoading: boolean;
  /** The catalog request failed and there is nothing to show. */
  loadFailed: boolean;
  onRetry: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  category: string;
  onCategoryChange: (category: string) => void;
  selectedService: string;
  onSelectService: (serviceName: string) => void;
  onContinue: () => void;
}

/** Step 1: search and filter the catalog, then pick one treatment. */
export const ServiceStep: React.FC<ServiceStepProps> = ({
  services,
  isLoading,
  loadFailed,
  onRetry,
  searchQuery,
  onSearchQueryChange,
  category,
  onCategoryChange,
  selectedService,
  onSelectService,
  onContinue,
}) => {
  const filteredServices = filterServices(services, category, searchQuery);

  // Without a catalog there is nothing to search or pick, and Continue would only fail validation.
  if (loadFailed) {
    return <ErrorState message="Couldn't load the service catalog." onRetry={onRetry} />;
  }
  if (isLoading) {
    return <LoadingIndicator message="Fetching catalog..." />;
  }

  return (
    <View>
      {/* Service Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={colors.text.muted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search treatments (fade, trim, shave)..."
          placeholderTextColor={colors.text.muted}
          value={searchQuery}
          onChangeText={onSearchQueryChange}
        />
      </View>

      {/* Category Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
        {CATEGORIES.map((cat) => {
          const isSel = category === cat;
          const displayLabel = CATEGORY_LABELS[cat] ?? cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[styles.catChip, isSel && styles.catChipSelected]}
              onPress={() => onCategoryChange(cat)}
            >
              <Text style={[styles.catText, isSel && styles.catTextSelected]}>{displayLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={wizardStyles.label}>Choose Service</Text>
      {filteredServices.length === 0 && (
        <EmptyState
          icon="search-outline"
          title="No Services Found"
          message="Try adjusting your category filter or search query."
        />
      )}
      {filteredServices.map((svc) => {
        const isSel = selectedService === svc.name;
        return (
          <TouchableOpacity
            key={svc.id}
            style={[wizardStyles.optionCard, isSel && wizardStyles.optionSelected]}
            onPress={() => onSelectService(svc.name)}
          >
            <View style={styles.optionInfo}>
              <View style={styles.optionRow}>
                {isSel && <Text style={styles.crownIcon}>👑</Text>}
                <Text style={wizardStyles.optionTitle}>{svc.name}</Text>
              </View>
              <Text style={styles.optionSub}>Duration: {svc.durationMinutes} mins</Text>
              <Text style={styles.optionDesc}>{svc.description}</Text>
            </View>
            <Text style={styles.optionPrice}>${svc.price.toFixed(2)}</Text>
          </TouchableOpacity>
        );
      })}

      <Button
        title="Continue to Stylist"
        variant="primary"
        size="lg"
        onPress={onContinue}
        style={styles.continueBtn}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 13,
    paddingVertical: 10,
  },
  // Category Tabs
  catScroll: {
    maxHeight: 36,
    marginBottom: 16,
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginRight: 6,
  },
  catChipSelected: {
    backgroundColor: colors.obsidian.card,
    borderColor: colors.gold.main,
  },
  catText: {
    color: colors.text.secondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  catTextSelected: {
    color: colors.gold.main,
  },
  // Service rows
  optionInfo: {
    flex: 1,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  crownIcon: {
    fontSize: 14,
  },
  optionSub: {
    color: colors.text.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  optionDesc: {
    color: colors.text.secondary,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  optionPrice: {
    color: colors.gold.main,
    fontSize: 15,
    fontWeight: '800',
  },
  continueBtn: {
    marginTop: 24,
  },
});
