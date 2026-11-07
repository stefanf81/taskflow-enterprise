import React, { useState, useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { useFlashMessage } from '../../components/common/useFlashMessage';
import {
  useAppointments,
  useUpdateAppointmentStatus,
  useDeleteAppointment,
} from '../../core/appointments/useAppointments';
import { useAuthStore } from '../../core/auth/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { colors } from '../../theme/colors';
import { formatTime12Hour, isOverdue } from '../../utils/time-utils';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { useNow } from '../booking/useNow';
import { getApiErrorMessage } from '../../utils/errors';

const FILTERS = ['all', 'pending', 'approved', 'overdue', 'denied', 'cancelled'];

export const AdminDashboardScreen: React.FC = () => {
  const isFocused = useIsFocused();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Debounce the search term before it reaches the query hook so the admin
  // dashboard does not fire a backend request on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, isSuccess, isPlaceholderData, isFetching, refetch } =
    useAppointments(filter, debouncedSearch, page, 10, { subscribed: isFocused });
  const updateStatusMutation = useUpdateAppointmentStatus();
  const deleteMutation = useDeleteAppointment();
  const { timeZone } = useShopInfo();
  const now = useNow(60_000, timeZone);
  const actionLocks = useRef(new Set<number>());
  const syncingRef = useRef(false);
  const [busyIds, setBusyIds] = useState<number[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { logout } = useAuthStore(useShallow((state) => ({ logout: state.logout })));

  useEffect(() => {
    // Previous-page placeholders and an in-flight refresh are not authoritative metadata.
    if (!isFocused || !isSuccess || isPlaceholderData || isFetching || !data) return;
    const lastPage = Math.max(0, data.page.page.totalPages - 1);
    if (page > lastPage) setPage(lastPage);
  }, [data, isFocused, isSuccess, isPlaceholderData, isFetching, page]);

  // Auto-dismissing success/error banners
  const { successMessage, errorMessage, showSuccess, showError, dismissSuccess } =
    useFlashMessage();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Sign-out failed. Please try again.'));
    }
  };

  const handleSync = () => {
    if (syncingRef.current || isSyncing) return;
    syncingRef.current = true;
    setIsSyncing(true);
    dismissSuccess();
    void Promise.resolve()
      .then(() => refetch({ throwOnError: true }))
      .then(
        () => {
          syncingRef.current = false;
          setIsSyncing(false);
          showSuccess('Database synced.');
        },
        (err: unknown) => {
          syncingRef.current = false;
          setIsSyncing(false);
          showError(getApiErrorMessage(err, 'Failed to sync appointments. Please try again.'));
        },
      );
  };

  const runAction = (
    id: number,
    action: () => Promise<unknown>,
    success: string,
    fallback: string,
  ) => {
    // The ref closes the gap before React renders the disabled row. Each row has its own lock.
    if (actionLocks.current.has(id)) return;
    actionLocks.current.add(id);
    setBusyIds((ids) => [...ids, id]);
    const unlock = () => {
      actionLocks.current.delete(id);
      setBusyIds((ids) => ids.filter((busyId) => busyId !== id));
    };
    void Promise.resolve()
      .then(action)
      .then(
        () => {
          unlock();
          showSuccess(success);
        },
        (err: unknown) => {
          unlock();
          showError(getApiErrorMessage(err, fallback));
        },
      );
  };

  const handleApprove = (id: number) => runAction(
    id,
    () => updateStatusMutation.mutateAsync({ id, status: 'APPROVED' }),
    'Appointment APPROVED! Client notification email queued.',
    'Failed to approve appointment.',
  );

  const handleDeny = (id: number) => runAction(
    id,
    () => updateStatusMutation.mutateAsync({ id, status: 'DENIED' }),
    'Appointment DECLINED. Client notification email queued.',
    'Failed to decline appointment.',
  );

  const handleCancel = (id: number) => {
    const appointment = data?.page.content.find((item) => item.id === id);
    if (actionLocks.current.has(id) ||
      (appointment?.status !== 'PENDING' && appointment?.status !== 'APPROVED')) return;
    Alert.alert('Cancel Booking', 'Are you sure you want to cancel this booking?', [
      { text: 'Keep Booking', style: 'cancel' },
      {
        text: 'Cancel Booking',
        style: 'destructive',
        onPress: () => { void runAction(
          id,
          () => deleteMutation.mutateAsync(id),
          'Booking cancelled.',
          'Failed to cancel booking.',
        ); },
      },
    ]);
  };

  const appointments = data?.page?.content || [];
  const stats = data?.stats;
  const totalPages = data?.page?.page?.totalPages ?? 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* ===== HEADER ===== */}
        <View style={styles.header}>
          <View>
            <Text style={styles.badgeLabel}>ADMIN CONTROL CENTER</Text>
            <Text style={styles.title}>Owner Panel</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleSync} disabled={isSyncing} style={styles.syncBtn} accessibilityLabel="Sync" accessibilityState={{ disabled: isSyncing, busy: isSyncing }}>
              <Ionicons name="refresh-outline" size={18} color={colors.gold.main} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} accessibilityLabel="Logout">
              <Ionicons name="log-out-outline" size={20} color={colors.status.denied} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ===== ALERT BANNERS ===== */}
        <ErrorMessage message={errorMessage || ''} />
        {successMessage && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.status.approved} />
            <Text style={styles.successText}>{successMessage}</Text>
            <TouchableOpacity onPress={dismissSuccess}>
              <Text style={styles.dismissBtn}>×</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ===== STATS BOARD (5 tiles) ===== */}
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
              <Text style={styles.statLbl}>Pending Approval</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statVal, { color: colors.status.approved }]}>
                {stats.approved}
              </Text>
              <Text style={styles.statLbl}>Approved Slots</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statVal, { color: colors.status.denied }]}>
                {stats.overdue ?? 0}
              </Text>
              <Text style={styles.statLbl}>Overdue Pending</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statVal, { color: colors.gold.bright }]}>
                ${(stats.approvedRevenue ?? 0).toFixed(0)}
              </Text>
              <Text style={styles.statLbl}>Est. Revenue</Text>
            </Card>
          </ScrollView>
        )}

        {/* ===== PROGRESS RATE BAR ===== */}
        {stats && (
          <Card style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Slot Approval Completion Rate</Text>
              <Text style={styles.progressPct}>{stats.progress ?? 0}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${Math.min(stats.progress ?? 0, 100)}%` }]}
              />
            </View>
          </Card>
        )}

        {/* ===== MAIN CONTENT ===== */}
        <View style={styles.mainContent}>
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
            {isError ? (
              <ErrorState message="Couldn't load appointments." onRetry={() => refetch()} />
            ) : isLoading ? (
              <LoadingIndicator message="Loading bookings..." />
            ) : appointments.length === 0 ? (
              <View>
                <EmptyState
                  icon="clipboard-outline"
                  title="No Appointments Found"
                  message="No records match your filter criteria."
                />
                {page > 0 && (
                  <Button title="Back to first page" variant="secondary" onPress={() => setPage(0)} />
                )}
              </View>
            ) : (
              <FlatList
                data={appointments}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                  const overdue = item.status === 'PENDING' && isOverdue(item.bookingDate, now);
                  const isBusy = busyIds.includes(item.id);
                  // Cancelled bookings are final: no approve/decline actions.
                  const isCancelled = item.status.toUpperCase() === 'CANCELLED';
                  return (
                    <Card style={[styles.appCard, overdue && styles.overdueCard]}>
                      <View style={styles.cardTop}>
                        <Text style={styles.publicId}>{item.publicId}</Text>
                        {overdue ? (
                          <View style={styles.overdueBadge}>
                            <Text style={styles.overdueBadgeText}>OVERDUE</Text>
                          </View>
                        ) : (
                          <Badge status={item.status} />
                        )}
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
                        <Text style={[styles.infoVal, overdue && { color: colors.status.denied }]}>
                          {item.bookingDate} @ {formatTime12Hour(item.bookingTime)}
                        </Text>
                      </View>

                      {/* Actions */}
                      <View style={styles.actionRow}>
                        {!isCancelled && item.status !== 'APPROVED' && (
                          <Button
                            title="Approve"
                            variant="primary"
                            size="sm"
                             onPress={() => handleApprove(item.id)}
                             disabled={isBusy}
                            style={styles.actionBtn}
                          />
                        )}
                        {!isCancelled && item.status !== 'DENIED' && (
                          <Button
                            title="Decline"
                            variant="danger"
                            size="sm"
                             onPress={() => handleDeny(item.id)}
                             disabled={isBusy}
                            style={styles.actionBtn}
                          />
                        )}
                        {(item.status === 'PENDING' || item.status === 'APPROVED') && <Button
                          title="Cancel"
                          variant="secondary"
                          size="sm"
                          onPress={() => handleCancel(item.id)}
                          disabled={isBusy}
                          style={styles.actionBtn}
                        />}
                      </View>
                    </Card>
                  );
                }}
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncBtn: {
    padding: 8,
    backgroundColor: colors.obsidian.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  logoutBtn: {
    padding: 8,
  },
  // Alert banners
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  successText: {
    color: colors.status.approved,
    fontSize: 12,
    flex: 1,
    marginLeft: 6,
    fontWeight: '500',
  },
  dismissBtn: {
    color: colors.status.approved,
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  // Stats
  statsScroll: {
    maxHeight: 80,
    marginBottom: 8,
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
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center',
  },
  // Progress bar
  progressCard: {
    padding: 12,
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    color: colors.text.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressPct: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '800',
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.gold.main,
    borderRadius: 3,
  },
  // Main content area
  mainContent: {
    flex: 1,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  filterChip: {
    flex: 1,
    paddingVertical: 7,
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
    fontSize: 9,
    fontWeight: '700',
  },
  filterTextSel: {
    color: colors.obsidian.bg,
  },
  listContent: {
    paddingBottom: 20,
  },
  appCard: {
    marginBottom: 10,
  },
  overdueCard: {
    borderColor: colors.status.denied,
    borderWidth: 1,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  publicId: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  overdueBadge: {
    backgroundColor: colors.status.denied,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  overdueBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  custName: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  custContact: {
    color: colors.text.muted,
    fontSize: 11,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  infoLbl: {
    color: colors.text.secondary,
    fontSize: 11,
  },
  infoVal: {
    color: colors.text.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.obsidian.border,
    paddingTop: 8,
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
