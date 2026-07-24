import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { EmptyState } from '../components/common/EmptyState';
import {
  useAppointments,
  useUpdateAppointmentStatus,
  useDeleteAppointment,
} from '../hooks/useAppointments';
import { useAuthStore } from '../store/useAuthStore';
import { colors } from '../theme/colors';

const FILTERS = ['all', 'pending', 'approved', 'denied'];

export const AdminDashboardScreen: React.FC = () => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useAppointments(filter, search, page, 10);
  const updateStatusMutation = useUpdateAppointmentStatus();
  const deleteMutation = useDeleteAppointment();
  const { logout } = useAuthStore();

  const handleApprove = (id: number) => {
    updateStatusMutation.mutate({ id, status: 'APPROVED' });
  };

  const handleDeny = (id: number) => {
    updateStatusMutation.mutate({ id, status: 'DENIED' });
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Booking', 'Are you sure you want to delete this booking?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const appointments = data?.page?.content || [];
  const stats = data?.stats;
  const totalPages = data?.page?.totalPages || 1;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.badgeLabel}>ADMIN CONTROL CENTER</Text>
            <Text style={styles.title}>Dashboard</Text>
          </View>
          <TouchableOpacity onPress={() => logout()} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color={colors.status.denied} />
          </TouchableOpacity>
        </View>

        {/* Stats Row */}
        {stats && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsScroll}>
            <Card style={styles.statCard}>
              <Text style={styles.statVal}>{stats.total}</Text>
              <Text style={styles.statLbl}>Total Bookings</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statVal, { color: colors.status.pending }]}>
                {stats.pending}
              </Text>
              <Text style={styles.statLbl}>Pending</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statVal, { color: colors.status.approved }]}>
                {stats.approved}
              </Text>
              <Text style={styles.statLbl}>Approved</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statVal, { color: colors.gold.bright }]}>
                ${stats.approvedRevenue?.toFixed(0) || 0}
              </Text>
              <Text style={styles.statLbl}>Est. Revenue</Text>
            </Card>
          </ScrollView>
        )}

        {/* Search Input */}
        <Input
          placeholder="Search by name, email, phone, or public ID..."
          value={search}
          onChangeText={(t) => {
            setSearch(t);
            setPage(0);
          }}
          icon={<Ionicons name="search" size={18} color={colors.text.muted} />}
        />

        {/* Filters */}
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const isSel = filter === f;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, isSel && styles.filterSelected]}
                onPress={() => {
                  setFilter(f);
                  setPage(0);
                }}
              >
                <Text style={[styles.filterText, isSel && styles.filterTextSel]}>
                  {f.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* List of Appointments */}
        {isLoading ? (
          <LoadingIndicator message="Loading bookings..." />
        ) : appointments.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            title="No Appointments Found"
            message="No records match your filter criteria."
          />
        ) : (
          <FlatList
            data={appointments}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.appCard}>
                <View style={styles.cardTop}>
                  <Text style={styles.publicId}>{item.publicId}</Text>
                  <Badge status={item.status} />
                </View>

                <Text style={styles.custName}>{item.customerName}</Text>
                <Text style={styles.custContact}>
                  {item.customerEmail} • {item.customerPhone}
                </Text>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLbl}>Service:</Text>
                  <Text style={styles.infoVal}>{item.serviceType}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLbl}>Barber:</Text>
                  <Text style={styles.infoVal}>{item.barberName}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLbl}>Date & Time:</Text>
                  <Text style={styles.infoVal}>
                    {item.bookingDate} @ {item.bookingTime}
                  </Text>
                </View>

                {/* Actions */}
                <View style={styles.actionRow}>
                  {item.status !== 'APPROVED' && (
                    <Button
                      title="Approve"
                      variant="primary"
                      size="sm"
                      onPress={() => handleApprove(item.id)}
                      style={styles.actionBtn}
                    />
                  )}
                  {item.status !== 'DENIED' && (
                    <Button
                      title="Decline"
                      variant="danger"
                      size="sm"
                      onPress={() => handleDeny(item.id)}
                      style={styles.actionBtn}
                    />
                  )}
                  <Button
                    title="Delete"
                    variant="secondary"
                    size="sm"
                    onPress={() => handleDelete(item.id)}
                    style={styles.actionBtn}
                  />
                </View>
              </Card>
            )}
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <View style={styles.pagination}>
            <Button
              title="Prev"
              variant="secondary"
              size="sm"
              disabled={page === 0}
              onPress={() => setPage((p) => Math.max(0, p - 1))}
            />
            <Text style={styles.pageText}>
              Page {page + 1} of {totalPages}
            </Text>
            <Button
              title="Next"
              variant="secondary"
              size="sm"
              disabled={page >= totalPages - 1}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
  logoutBtn: {
    padding: 8,
  },
  statsScroll: {
    maxHeight: 70,
    marginBottom: 16,
  },
  statCard: {
    width: 100,
    padding: 10,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statVal: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '800',
  },
  statLbl: {
    color: colors.text.muted,
    fontSize: 10,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: colors.obsidian.card,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    alignItems: 'center',
  },
  filterSelected: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  filterText: {
    color: colors.text.secondary,
    fontSize: 11,
    fontWeight: '700',
  },
  filterTextSel: {
    color: colors.obsidian.bg,
  },
  listContent: {
    paddingBottom: 20,
  },
  appCard: {
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  publicId: {
    color: colors.gold.main,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  custName: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  custContact: {
    color: colors.text.muted,
    fontSize: 12,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  infoLbl: {
    color: colors.text.secondary,
    fontSize: 12,
  },
  infoVal: {
    color: colors.text.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.obsidian.border,
    paddingTop: 10,
  },
  actionBtn: {
    flex: 1,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
  },
  pageText: {
    color: colors.text.secondary,
    fontSize: 12,
  },
});
