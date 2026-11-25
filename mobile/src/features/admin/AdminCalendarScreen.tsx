import React, { memo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, SectionList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type CalendarView,
  datesOf,
  rangeOf,
  shiftDate,
  stepOf,
} from '@taskflow/domain/src/calendar';
import { parseLocalDate, toLocalDateString } from '@taskflow/domain';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { ErrorState } from '../../components/common/ErrorState';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { useFlashMessage } from '../../components/common/useFlashMessage';
import { useAppointmentsInRange } from '../../core/appointments/useAppointments';
import { useAdminBarbers } from '../../core/barbers/useBarbers';
import { useNow } from '../../core/shop/useNow';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { colors, semantic, withAlpha } from '../../theme/colors';
import { formatTime12Hour } from '../../utils/time-utils';
import type { AppointmentItem } from '../../types/api';
import { buildAgenda, calendarBarbers } from './calendarAgenda';
import { useBookingActions } from './useBookingActions';

const DAY_TITLE = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } as const;
const SHORT_DATE = { month: 'short', day: 'numeric' } as const;
const SECTION_TITLE = { weekday: 'short', month: 'short', day: 'numeric' } as const;

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  parseLocalDate(date).toLocaleDateString('en-US', options);

/**
 * Owner calendar: a day or a week of bookings that hold a slot, grouped per day with the earliest
 * first, optionally for one barber. A phone has no room for a column per barber, so the barber is a
 * filter here (the web calendar has the columns). Tapping a booking opens its details and actions.
 */
export const AdminCalendarScreen: React.FC = () => {
  const isFocused = useIsFocused();
  const { timeZone } = useShopInfo();
  const now = useNow(60_000, timeZone);
  const [view, setView] = useState<CalendarView>('day');
  // The day (or a day of the week) shown; starts at today in the shop's calendar.
  const [anchor, setAnchor] = useState(() => toLocalDateString(now));
  const [barber, setBarber] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const range = rangeOf(view, anchor);
  const { data, isLoading, isError, refetch } = useAppointmentsInRange(range.from, range.to, {
    subscribed: isFocused,
  });
  const { data: barbers } = useAdminBarbers();
  const { successMessage, errorMessage, showSuccess, showError, dismissSuccess } =
    useFlashMessage();
  const { busyIds, approve, deny, cancel } = useBookingActions({ showSuccess, showError });

  const barberNames = calendarBarbers(barbers ?? [], data ?? []);
  // A chosen barber who is no longer listed (their last booking here was cancelled): show all.
  const activeBarber = barber !== null && barberNames.includes(barber) ? barber : null;
  const agenda = buildAgenda(data ?? [], datesOf(range), activeBarber);
  const count = agenda.reduce((sum, day) => sum + day.items.length, 0);
  const title =
    view === 'day'
      ? format(range.from, DAY_TITLE)
      : `${format(range.from, SHORT_DATE)} – ${format(range.to, SHORT_DATE)}, ${range.to.slice(0, 4)}`;

  const move = (direction: 1 | -1) => setAnchor((date) => shiftDate(date, direction * stepOf(view)));

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.badgeLabel}>ADMIN CONTROL CENTER</Text>
        <Text style={styles.title}>Calendar</Text>

        <View style={styles.navRow}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => move(-1)}
            accessibilityLabel={`Previous ${view}`}
          >
            <Ionicons name="chevron-back" size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.todayBtn}
            onPress={() => setAnchor(toLocalDateString(now))}
            accessibilityLabel="Today"
          >
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => move(1)}
            accessibilityLabel={`Next ${view}`}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={styles.viewToggle}>
            {(['day', 'week'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, view === option && styles.chipSelected]}
                onPress={() => setView(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: view === option }}
                accessibilityLabel={`${option === 'day' ? 'Day' : 'Week'} view`}
              >
                <Text style={[styles.chipText, view === option && styles.chipTextSelected]}>
                  {option.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.range} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.count}>
          {count} {count === 1 ? 'booking' : 'bookings'}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.barberScroll}
          contentContainerStyle={styles.barberRow}
        >
          {[null, ...barberNames].map((name) => (
            <TouchableOpacity
              key={name ?? 'all'}
              style={[styles.chip, styles.barberChip, activeBarber === name && styles.chipSelected]}
              onPress={() => setBarber(name)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeBarber === name }}
              accessibilityLabel={name ? `Barber ${name}` : 'All barbers'}
            >
              <Text style={[styles.chipText, activeBarber === name && styles.chipTextSelected]}>
                {name ?? 'ALL BARBERS'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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

        {/* Data first: a failed background refetch keeps the bookings already loaded. */}
        {isError && data !== undefined && (
          <ErrorMessage message="Couldn't refresh the calendar. Showing the last loaded bookings." />
        )}
        {isError && data === undefined ? (
          <ErrorState message="Couldn't load the calendar." onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingIndicator message="Loading calendar..." />
        ) : count === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing booked"
            message="No pending or approved bookings in this view."
          />
        ) : (
          <SectionList
            sections={agenda.map((day) => ({ ...day, data: day.items }))}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            // A day view shows its date in the title already.
            renderSectionHeader={({ section }) =>
              view === 'week' ? (
                <Text style={styles.sectionTitle}>{format(section.date, SECTION_TITLE)}</Text>
              ) : null
            }
            renderSectionFooter={({ section }) =>
              section.items.length === 0 && view === 'week' ? (
                <Text style={styles.emptyDay}>No bookings</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <BookingRow
                item={item}
                showBarber={activeBarber === null}
                open={openId === item.id}
                isBusy={busyIds.includes(item.id)}
                onToggle={setOpenId}
                onApprove={approve}
                onDeny={deny}
                onCancel={cancel}
              />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

interface BookingRowProps {
  item: AppointmentItem;
  showBarber: boolean;
  open: boolean;
  isBusy: boolean;
  onToggle: (id: number | null) => void;
  onApprove: (id: number) => void;
  onDeny: (id: number) => void;
  onCancel: (appointment: AppointmentItem) => void;
}

/** One booking: a tap opens its contact details and actions. Memoised with primitive props. */
const BookingRow = memo(function BookingRow({
  item,
  showBarber,
  open,
  isBusy,
  onToggle,
  onApprove,
  onDeny,
  onCancel,
}: BookingRowProps) {
  return (
    <Card style={[styles.row, open && styles.rowOpen]}>
      <TouchableOpacity
        onPress={() => onToggle(open ? null : item.id)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${formatTime12Hour(item.bookingTime)}, ${item.customerName}, ${item.serviceType} with ${item.barberName}, ${item.status.toLowerCase()}`}
      >
        <View style={styles.rowTop}>
          <Text style={styles.time}>{formatTime12Hour(item.bookingTime)}</Text>
          <Badge status={item.status} />
        </View>
        <Text style={styles.name}>{item.customerName}</Text>
        <Text style={styles.detail}>
          {item.serviceType}
          {showBarber ? ` · ${item.barberName}` : ''}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.details}>
          <Text style={styles.contact}>
            {item.customerEmail} • {item.customerPhone}
          </Text>
          <View style={styles.actionRow}>
            {item.status === 'PENDING' && (
              <Button
                title="Approve"
                size="sm"
                disabled={isBusy}
                onPress={() => onApprove(item.id)}
                style={styles.actionBtn}
              />
            )}
            <Button
              title="Decline"
              variant="danger"
              size="sm"
              disabled={isBusy}
              onPress={() => onDeny(item.id)}
              style={styles.actionBtn}
            />
            <Button
              title="Cancel"
              variant="secondary"
              size="sm"
              disabled={isBusy}
              onPress={() => onCancel(item)}
              style={styles.actionBtn}
            />
          </View>
        </View>
      )}
    </Card>
  );
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.obsidian.bg },
  container: { flex: 1, padding: 16 },
  badgeLabel: { color: colors.gold.main, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  title: { color: colors.text.primary, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  iconBtn: {
    padding: 8,
    backgroundColor: colors.obsidian.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  todayBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: colors.obsidian.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  todayText: { color: colors.text.primary, fontSize: 12, fontWeight: '700' },
  viewToggle: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: colors.obsidian.card,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    alignItems: 'center',
  },
  chipSelected: { backgroundColor: colors.gold.main, borderColor: colors.gold.main },
  chipText: { color: colors.text.secondary, fontSize: 10, fontWeight: '700' },
  chipTextSelected: { color: colors.obsidian.bg },
  range: { color: colors.text.primary, fontSize: 16, fontWeight: '800' },
  count: { color: colors.text.muted, fontSize: 11, marginTop: 2, marginBottom: 10 },
  barberScroll: { flexGrow: 0, marginBottom: 12 },
  barberRow: { gap: 6 },
  barberChip: { minWidth: 70 },
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
  successText: { color: colors.status.approved, fontSize: 12, flex: 1, marginLeft: 6 },
  dismissBtn: { color: colors.status.approved, fontSize: 18, fontWeight: '700', marginLeft: 8 },
  listContent: { paddingBottom: 24 },
  sectionTitle: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 6,
  },
  emptyDay: { color: colors.text.muted, fontSize: 12, marginBottom: 6 },
  row: { padding: 12, marginBottom: 8 },
  rowOpen: { borderColor: colors.gold.main },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { color: colors.text.primary, fontSize: 14, fontWeight: '800' },
  name: { color: colors.text.primary, fontSize: 14, fontWeight: '700', marginTop: 4 },
  detail: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  details: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.obsidian.border,
  },
  contact: { color: colors.text.muted, fontSize: 12, marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },
});
