import React from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView } from 'react-native';
import { Card } from '../components/common/Card';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { useCatalog } from '../hooks/useCatalog';
import { colors } from '../theme/colors';

export const AdminCatalogScreen: React.FC = () => {
  const { data: services = [], isLoading } = useCatalog();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.badgeLabel}>SERVICE CATALOG</Text>
          <Text style={styles.title}>Menu & Pricing</Text>
        </View>

        {isLoading ? (
          <LoadingIndicator message="Loading service catalog..." />
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
                <Text style={styles.category}>{item.category.replace('_', ' ')}</Text>
                <Text style={styles.description}>{item.description}</Text>
                <Text style={styles.duration}>Duration: {item.durationMinutes} mins</Text>
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
