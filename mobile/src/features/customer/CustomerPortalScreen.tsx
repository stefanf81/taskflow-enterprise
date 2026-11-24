import React, { memo, useState, useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  FlatList,
  Alert,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { useFlashMessage } from '../../components/common/useFlashMessage';
import { customerApi } from './customer';
import {
  useCustomerAppointments,
  useCancelCustomerAppointment,
  useRescheduleCustomerAppointment,
} from './useCustomer';
import { ReschedulePicker, type RescheduleSelection } from '../../core/appointments/ReschedulePicker';
import { shareCalendarFile } from '../../core/calendar/shareCalendarFile';
import { useAuthStore } from '../../core/auth/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { colors, semantic, withAlpha } from '../../theme/colors';
import { isCustomerCancellable, type ShopRules } from '@taskflow/domain';
import type { AppointmentItem } from '../../types/api';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { formatTime12Hour, shopWallClock, type WallClock } from '../../utils/time-utils';
import { getApiErrorMessage } from '../../utils/errors';
import { useNow } from '../../core/shop/useNow';

export const CustomerPortalScreen: React.FC = () => {
  const isFocused = useIsFocused();
  const [page, setPage] = useState(0);
  const { data, isLoading, isError, isSuccess, isPlaceholderData, isFetching, refetch } =
    useCustomerAppointments(page, 10, { subscribed: isFocused });
  // The stable functions and plain values, not the mutation results: those change identity at
  // every state, and every row's handlers with them (BENCHMARKS.md §79).
  const {
    mutate: cancelBooking,
    isPending: cancelPending,
    variables: cancellingId,
  } = useCancelCustomerAppointment();
  const { mutate: rescheduleBooking, isPending: rescheduling } = useRescheduleCustomerAppointment();
  const cancelLock = useRef(false);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  // Only an upcoming PENDING or APPROVED booking can be cancelled, the rule the server applies.
  const { timeZone: shopTimeZone, rules: shopRules } = useShopInfo();
  const now = useNow(60_000, shopTimeZone);
  const { username, logout } = useAuthStore(
    useShallow((state) => ({ username: state.username, logout: state.logout })),
  );

  // Auto-dismissing alert banners
  const { successMessage, errorMessage, showSuccess, showError, dismissSuccess } =
    useFlashMessage();

  useEffect(() => {
    if (!isFocused || !isSuccess || isPlaceholderData || isFetching || !data) return;
    const lastPage = Math.max(0, data.page.totalPages - 1);
    if (page > lastPage) setPage(lastPage);
  }, [data, isFocused, isSuccess, isPlaceholderData, isFetching, page]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Sign-out failed. Please try again.'));
    }
  };

  // Takes the row's booking rather than finding it in `data`, which changes on every refetch.
  const handleCancel = (appointment: AppointmentItem) => {
    if (cancelLock.current || cancelPending) return;
    Alert.alert(
      'Cancel Appointment',
      'Are you sure you want to cancel this booking?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: () => {
            // The time may have moved past the cancellation window while the dialog was open.
            if (cancelLock.current ||
              !isCustomerCancellable(appointment, shopWallClock(shopTimeZone))) return;
            cancelLock.current = true;
            cancelBooking(appointment.publicId, {
              onSuccess: () => {
                showSuccess('Appointment cancelled successfully.');
              },
              onError: (err) => showError(getApiErrorMessage(err, 'Failed to cancel appointment.')),
              onSettled: () => { cancelLock.current = false; },
            });
          },
        },
      ],
    );
  };

  // A .ics file in the share sheet (Calendar imports it), never the raw text.
  const handleExportCalendar = (publicId: string) => {
    if (exportingId) return;
    setExportingId(publicId);
    void customerApi
      .exportCalendar(publicId)
      .then(({ content, filename }) => shareCalendarFile(content, filename))
      .then(
        (shared) => {
          setExportingId(null);
          if (!shared) showError('This device cannot share the calendar file.');
        },
        (err: unknown) => {
          setExportingId(null);
          showError(getApiErrorMessage(err, 'Failed to export the calendar file.'));
        },
      );
  };

  const handleReschedule = (publicId: string, slot: RescheduleSelection) => {
    if (rescheduling) return;
    rescheduleBooking(
      { publicId, ...slot },
      {
        onSuccess: () => {
          setRescheduleId(null);
          showSuccess('Appointment moved. It is pending the shop’s confirmation again.');
        },
        onError: (err) => showError(getApiErrorMessage(err, 'Failed to reschedule the appointment.')),
      },
    );
  };

  const closeReschedule = () => setRescheduleId(null);

  const appointments = data?.content || [];
  const totalPages = data?.page?.totalPages ?? 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Profile / Account Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome Back</Text>
            <Text style={styles.username}>{username || 'Valued Customer'}</Text>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={colors.status.denied} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Alert Banners */}
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

        <Text style={styles.sectionTitle}>My Bookings</Text>

        {isError ? (
          <ErrorState message="Couldn't load your bookings." onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingIndicator message="Loading your appointments..." />
        ) : appointments.length === 0 ? (
          <View>
            <EmptyState
              icon="calendar-outline"
              title="No Bookings Found"
              message="You haven't reserved any appointments yet."
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
            renderItem={({ item }) => (
              <CustomerAppointmentRow
                item={item}
                cancellable={isCustomerCancellable(item, now)}
                exporting={exportingId === item.publicId}
                exportLocked={exportingId !== null}
                actionsLocked={cancelPending || rescheduling}
                cancelling={cancelPending && cancellingId === item.publicId}
                // Only the open picker needs the clock: the other rows skip the minute tick.
                pickerNow={rescheduleId === item.publicId ? now : null}
                rules={shopRules}
                rescheduling={rescheduling}
                onExport={handleExportCalendar}
                onOpenReschedule={setRescheduleId}
                onCancel={handleCancel}
                onReschedule={handleReschedule}
                onClosePicker={closeReschedule}
              />
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

interface CustomerAppointmentRowProps {
  item: AppointmentItem;
  cancellable: boolean;
  exporting: boolean;
  exportLocked: boolean;
  actionsLocked: boolean;
  cancelling: boolean;
  /** The clock for the open reschedule picker; null on every other row. */
  pickerNow: WallClock | null;
  rules: ShopRules;
  rescheduling: boolean;
  onExport: (publicId: string) => void;
  onOpenReschedule: (publicId: string) => void;
  onCancel: (appointment: AppointmentItem) => void;
  onReschedule: (publicId: string, slot: RescheduleSelection) => void;
  onClosePicker: () => void;
}

/**
 * One booking. Memoised with primitive props, so an action re-renders only the rows whose state
 * it changes: built inline in `renderItem`, every row re-rendered at each mutation state and on
 * every clock tick (BENCHMARKS.md §79).
 */
const CustomerAppointmentRow = memo(function CustomerAppointmentRow({
  item,
  cancellable,
  exporting,
  exportLocked,
  actionsLocked,
  cancelling,
  pickerNow,
  rules,
  rescheduling,
  onExport,
  onOpenReschedule,
  onCancel,
  onReschedule,
  onClosePicker,
}: CustomerAppointmentRowProps) {
  return (
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

      {cancellable && (
        <View>
          <View style={styles.actionRow}>
            <Button
              title="Add to Calendar"
              variant="secondary"
              size="sm"
              loading={exporting}
              disabled={exportLocked}
              onPress={() => onExport(item.publicId)}
              style={styles.cancelBtn}
            />
            <Button
              title="Reschedule"
              variant="secondary"
              size="sm"
              disabled={actionsLocked}
              onPress={() => onOpenReschedule(item.publicId)}
              style={styles.cancelBtn}
            />
            <Button
              title="Cancel Booking"
              variant="outline"
              size="sm"
              loading={cancelling}
              disabled={actionsLocked}
              onPress={() => onCancel(item)}
              style={styles.cancelBtn}
            />
          </View>
          {pickerNow && (
            <ReschedulePicker
              now={pickerNow}
              rules={rules}
              publicId={item.publicId}
              currentDate={item.bookingDate}
              currentTime={item.bookingTime}
              saving={rescheduling}
              onConfirm={(slot) => onReschedule(item.publicId, slot)}
              onClose={onClosePicker}
            />
          )}
        </View>
      )}
    </Card>
  );
});

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
    backgroundColor: withAlpha(semantic.success, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(semantic.success, 0.3),
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
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
