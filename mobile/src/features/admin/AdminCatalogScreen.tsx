import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { useFlashMessage } from '../../components/common/useFlashMessage';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { useCatalog, useRestoreService, useRetiredServices } from '../../core/catalog/useCatalog';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

type CatalogTab = 'active' | 'retired';

const TABS: ReadonlyArray<{ key: CatalogTab; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'retired', label: 'Retired' },
];

export const AdminCatalogScreen: React.FC = () => {
  const [tab, setTab] = useState<CatalogTab>('active');
  const showingRetired = tab === 'retired';

  // The retired list is only requested once its tab is opened.
  const active = useCatalog();
  const retired = useRetiredServices({ enabled: showingRetired });
  const { data: services = [], isLoading, isError, refetch } = showingRetired ? retired : active;

  const restoreMutation = useRestoreService();
  const { successMessage, errorMessage, showSuccess, showError } = useFlashMessage();

  const handleRestore = (id: number, name: string) => {
    restoreMutation.mutate(id, {
      onSuccess: () => showSuccess(`${name} is bookable again.`),
      onError: (err) => showError(getApiErrorMessage(err, `Could not restore ${name}.`)),
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.badgeLabel}>SERVICE CATALOG</Text>
          <Text style={styles.title}>Menu & Pricing</Text>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map(({ key, label }) => {
            const selected = tab === key;
            return (
              <TouchableOpacity
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.tab, selected && styles.tabSelected]}
                onPress={() => setTab(key)}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ErrorMessage message={errorMessage || ''} />
        {successMessage && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        )}

        {isError ? (
          <ErrorState
            message={
              showingRetired
                ? "Couldn't load the retired services."
                : "Couldn't load the service catalog."
            }
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <LoadingIndicator
            message={showingRetired ? 'Loading retired services...' : 'Loading service catalog...'}
          />
        ) : services.length === 0 ? (
          showingRetired ? (
            <EmptyState
              icon="archive-outline"
              title="No Retired Services"
              message="A service is retired when it is deleted but still has bookings."
            />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title="No Services Found"
              message="The service catalog is currently empty."
            />
          )
        ) : (
          <FlatList
            data={services}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.price}>${item.price.toFixed(2)}</Text>
                </View>
                <Text style={styles.category}>{item.category.toUpperCase()}</Text>
                <Text style={styles.description}>{item.description}</Text>
                <Text style={styles.duration}>Duration: {item.durationMinutes} mins</Text>
                {showingRetired && (
                  <Button
                    title="Restore"
                    variant="secondary"
                    size="sm"
                    loading={restoreMutation.isPending && restoreMutation.variables === item.id}
                    disabled={restoreMutation.isPending}
                    onPress={() => handleRestore(item.id, item.name)}
                    style={styles.restoreButton}
                  />
                )}
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
    marginBottom: 16,
  },
  badgeLabel: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  tabSelected: {
    backgroundColor: colors.obsidian.card,
    borderColor: colors.gold.main,
  },
  tabText: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tabTextSelected: {
    color: colors.gold.main,
  },
  successBanner: {
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    color: colors.status.approved,
    fontSize: 12,
    fontWeight: '500',
  },
  restoreButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  listContent: {
    paddingBottom: 20,
  },
  card: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  price: {
    color: colors.gold.bright,
    fontSize: 16,
    fontWeight: '800',
  },
  category: {
    color: colors.gold.main,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  description: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  duration: {
    color: colors.text.muted,
    fontSize: 12,
    marginTop: 8,
  },
});
