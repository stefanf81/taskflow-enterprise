import React from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView } from 'react-native';
import { Card } from '../components/common/Card';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { EmptyState } from '../components/common/EmptyState';
import { useNotifications } from '../hooks/useNotifications';
import { colors } from '../theme/colors';

export const AdminNotificationsScreen: React.FC = () => {
  const { data: notifications = [], isLoading } = useNotifications();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.badgeLabel}>NOTIFICATION OUTBOX</Text>
          <Text style={styles.title}>Email Audit Log</Text>
        </View>

        {isLoading ? (
          <LoadingIndicator message="Loading email outbox..." />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon="mail-outline"
            title="Outbox Empty"
            message="No system notification emails have been dispatched."
          />
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.card}>
                <View style={styles.topRow}>
                  <Text style={styles.recipient}>{item.recipient}</Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusText}>{item.status}</Text>
                  </View>
                </View>

                <Text style={styles.type}>Type: {item.type}</Text>
                <Text style={styles.message}>{item.message}</Text>
                <Text style={styles.sentAt}>Dispatched: {item.sentAt}</Text>
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
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  recipient: {
    color: colors.gold.bright,
    fontSize: 14,
    fontWeight: '700',
  },
  statusBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    color: colors.status.approved,
    fontSize: 10,
    fontWeight: '700',
  },
  type: {
    color: colors.text.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  message: {
    color: colors.text.primary,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  sentAt: {
    color: colors.text.muted,
    fontSize: 11,
    marginTop: 8,
  },
});
