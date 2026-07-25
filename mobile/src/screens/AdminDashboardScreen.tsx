import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorMessage } from '../components/common/ErrorMessage';
import {
  useAppointments,
  useUpdateAppointmentStatus,
  useDeleteAppointment,
} from '../hooks/useAppointments';
import { useAuthStore } from '../store/useAuthStore';
import { colors } from '../theme/colors';
import { formatTime12Hour, isOverdue } from '../utils/time-utils';

const FILTERS = ['all', 'pending', 'approved', 'overdue', 'denied'];

export const AdminDashboardScreen: React.FC = () => {
  const { width } = useWindowDimensions();
  const isNarrowScreen = width < 480;

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data, isLoading, refetch } = useAppointments(filter, search, page, 10);
  const updateStatusMutation = useUpdateAppointmentStatus();
  const deleteMutation = useDeleteAppointment();
  const { logout } = useAuthStore();

  // Auto-dismiss success/error messages
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessMsg(null), 4500);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setErrorMsg(null), 4500);
  };

  const handleApprove = (id: number) => {
    updateStatusMutation.mutate(
      { id, status: 'APPROVED' },
      {
        onSuccess: () => {
          showSuccess('Appointment APPROVED! Client notification email dispatched.');
          refetch();
        },
        onError: () => showError('Failed to approve appointment.'),
      },
    );
  };

  const handleDeny = (id: number) => {
    updateStatusMutation.mutate(
      { id, status: 'DENIED' },
      {
        onSuccess: () => {
          showSuccess('Appointment DECLINED. Client notification email dispatched.');
          refetch();
        },
        onError: () => showError('Failed to decline appointment.'),
      },
    );
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Booking', 'Are you sure you want to permanently delete this booking?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteMutation.mutate(id, {
            onSuccess: () => {
              showSuccess('Booking permanently deleted.');
              refetch();
            },
            onError: () => showError('Failed to delete booking.'),
          });
        },
      },
    ]);
  };

  const appointments = data?.page?.content || [];
  const stats = data?.stats;
  const totalPages = data?.page?.totalPages || 1;

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
            <TouchableOpacity onPress={() => { refetch(); showSuccess('Database synced.'); }} style={styles.syncBtn}>
              <Ionicons name="refresh-outline" size={18} color={colors.gold.main} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => logout()} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={20} color={colors.status.denied} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ===== ALERT BANNERS ===== */}
        <ErrorMessage message={errorMsg || ''} />
        {successMsg && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.status.approved} />
            <Text style={styles.successText}>{successMsg}</Text>
            <TouchableOpacity onPress={() => setSuccessMsg(null)}>
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

        {/* ===== MAIN LAYOUT: Guidelines sidebar + List ===== */}
        <View style={[styles.mainLayout, isNarrowScreen && styles.mainLayoutStacked]}>
          {/* SIDEBAR: Owner Guidelines */}
          <View style={[styles.sidebar, isNarrowScreen && styles.sidebarStacked]}>
            <Card style={styles.guidelinesCard}>
              <Text style={styles.guidelinesTitle}>Owner Guidelines</Text>
              <Text style={styles.guidelinesDesc}>
                Welcome, boss! Use this dashboard to manage customer appointment requests:
              </Text>
              <View style={styles.guidelinesList}>
                <Text style={styles.guidelineItem}>• Review customer contact details before approving.</Text>
                <Text style={styles.guidelineItem}>• Status updates auto-trigger SMTP email notifications.</Text>
                <Text style={styles.guidelineItem}>• Check the "Pending" tab regularly to keep the schedule optimized!</Text>
              </View>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.status.pending }]} />
                  <Text style={styles.legendText}>Pending Approval</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.status.approved }]} />
                  <Text style={styles.legendText}>Approved Reservation</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.status.denied }]} />
                  <Text style={styles.legendText}>Denied Request</Text>
                </View>
              </View>
            </Card>
          </View>

          {/* MAIN CONTENT */}
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
                renderItem={({ item }) => {
                  const overdue = item.status === 'PENDING' && isOverdue(item.bookingDate);
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
  // Layout
  mainLayout: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  mainLayoutStacked: {
    flexDirection: 'column',
  },
  // Sidebar
  sidebar: {
    width: 180,
  },
  sidebarStacked: {
    width: '100%',
  },
  guidelinesCard: {
    padding: 12,
  },
  guidelinesTitle: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  guidelinesDesc: {
    color: colors.text.muted,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  guidelinesList: {
    marginBottom: 12,
  },
  guidelineItem: {
    color: colors.text.secondary,
    fontSize: 10,
    lineHeight: 16,
    marginBottom: 4,
  },
  legend: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: colors.text.secondary,
    fontSize: 10,
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
