import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ErrorState } from '../../components/common/ErrorState';
import { useCatalog } from '../../core/catalog/useCatalog';
import { colors } from '../../theme/colors';

/** The service catalog as a price list; a failed load shows a retry in place of the list only. */
export const GroomingMenu: React.FC = () => {
  const { data: services = [], isError, refetch } = useCatalog();

  return (
    <>
      <Text style={styles.menuHeader}>Grooming Menu</Text>

      {isError ? (
        <ErrorState
          title="Menu Unavailable"
          message="Couldn't load the grooming menu."
          onRetry={() => refetch()}
          testID="grooming-menu-error"
        />
      ) : (
        services.map((svc) => (
          <View key={svc.id} style={styles.menuItem}>
            <View style={styles.menuTop}>
              <Text style={styles.menuName}>{svc.name}</Text>
              <Text style={styles.menuPrice}>${svc.price.toFixed(2)}</Text>
            </View>
            <Text style={styles.menuDuration}>Duration: {svc.durationMinutes} mins</Text>
            <Text style={styles.menuDesc}>{svc.description}</Text>
          </View>
        ))
      )}
    </>
  );
};

const styles = StyleSheet.create({
  menuHeader: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  menuItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 12,
    marginBottom: 12,
  },
  menuTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  menuName: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  menuPrice: {
    color: colors.gold.main,
    fontSize: 14,
    fontWeight: '800',
  },
  menuDuration: {
    color: colors.text.muted,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  menuDesc: {
    color: colors.text.secondary,
    fontSize: 12,
    lineHeight: 16,
  },
});
