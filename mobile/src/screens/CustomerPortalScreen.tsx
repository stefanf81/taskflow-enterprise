import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Alert,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { useCustomerAppointments, useCancelCustomerAppointment } from '../hooks/useCustomer';
import { useAuthStore } from '../store/useAuthStore';
import { colors } from '../theme/colors';
import { formatTime12Hour } from '../utils/time-utils';

export const CustomerPortalScreen: React.FC = () => {
  const [page, setPage] = useState(0);
  const { data, isLoading, refetch } = useCustomerAppointments(page, 10);
  const cancelMutation = useCancelCustomerAppointment();
  const { username, logout } = useAuthStore();

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-dismiss
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (alertTimer.current) clearTimeout(alertTimer.current);
    };
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => setSuccessMsg(null), 4500);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => setErrorMsg(null), 4500);
  };

  const handleCancel = (id: number) => {
    Alert.alert(
      'Cancel Appointment',
      'Are you sure you want to cancel this booking?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: () => {
            cancelMutation.mutate(id, {
              onSuccess: () => {
                showSuccess('Appointment cancelled successfully.');
                refetch();
              },
              onError: () => showError('Failed to cancel appointment.'),
            });
          },
        },
      ],
    );
  };

  const appointments = data?.content || [];
  const totalPages = data?.totalPages || 1;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Profile / Account Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome Back</Text>
            <Text style={styles.username}>{username || 'Valued Customer'}</Text>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={() => logout()}>
            <Ionicons name="log-out-outline" size={20} color={colors.status.denied} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Alert Banners */}
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

        <Text style={styles.sectionTitle}>My Bookings</Text>

        {isLoading ? (
          <LoadingIndicator message="Loading your appointments..." />
        ) : appointments.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="No Bookings Found"
            message="You haven't reserved any appointments yet."
          />
        ) : (
          <FlatList
            data={appointments}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.itemCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.publicId}>{item.publicId}</Text>
                  <Badge status={item.status} />
                </View>

                <Text style={styles.serviceTitle}>{item.serviceType}</Text>

                <View style={styles.detailRow}>
                  <Ionicons name="person-outline" size={14} color={colors.gold.main} />
                  <Text style={styles.detailText}>Barber: {item.barberName}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Ionicons name="time-outline" size={14} color={colors.gold.main} />
                  <Text style={styles.detailText}>
                    Date: {item.bookingDate} @ {formatTime12Hour(item.bookingTime)}
                  </Text>
                </View>

                {item.status !== 'CANCELLED' && item.status !== 'DENIED' && (
                  <Button
                    title="Cancel Booking"
                    variant="outline"
                    size="sm"
                    loading={cancelMutation.isPending}
                    onPress={() => handleCancel(item.id)}
                    style={styles.cancelBtn}
                  />
                )}
              </Card>
            )}
          />
        )}

        {/* Pagination Controls */}
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
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.obsidian.border,
    paddingBottom: 16,
  },
  greeting: {
    color: colors.text.muted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  username: {
    color: colors.gold.main,
    fontSize: 20,
    fontWeight: '800',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  logoutText: {
    color: colors.status.denied,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
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
  sectionTitle: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 20,
  },
  itemCard: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  publicId: {
    color: colors.gold.main,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  serviceTitle: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  detailText: {
    color: colors.text.secondary,
    fontSize: 13,
    marginLeft: 6,
  },
  cancelBtn: {
    marginTop: 12,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
  },
  pageText: {
    color: colors.text.secondary,
    fontSize: 13,
  },
});
