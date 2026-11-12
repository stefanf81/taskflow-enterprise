import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../../components/common/Card';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { ErrorState } from '../../components/common/ErrorState';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import {
  useAdminBarbers,
  useBarberTimeOff,
  useAddTimeOff,
  useBarberSchedule,
} from '../../core/barbers/useBarbers';
import { AddBarberCard } from './AddBarberCard';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

export const AdminSchedulesScreen: React.FC = () => {
  const {
    data: barbers = [],
    isLoading: loadingBarbers,
    isError: barbersError,
    refetch: refetchBarbers,
  } = useAdminBarbers();
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);

  const {
    data: timeOffs = [],
    isLoading: loadingTimeOff,
    isError: timeOffError,
    refetch: refetchTimeOff,
  } = useBarberTimeOff(selectedBarberId);
  const addTimeOffMutation = useAddTimeOff();
  const schedule = useBarberSchedule(selectedBarberId);
  // Messages of the barber and weekly-hours actions (they outlive the editor's remount).
  const [staffMessage, setStaffMessage] = useState<{ error?: string; success?: string }>({});

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (barbers.length > 0 && selectedBarberId === null) {
      setSelectedBarberId(barbers[0].id);
    }
  }, [barbers]);

  const handleAddTimeOff = async () => {
    if (!selectedBarberId) return;
    if (!startDate.trim() || !endDate.trim()) {
      setError('Start date and end date are required.');
      return;
    }

    setError(null);
    try {
      await addTimeOffMutation.mutateAsync({
        barberId: selectedBarberId,
        data: {
          startDate: startDate.trim(),
          endDate: endDate.trim(),
          reason: reason.trim(),
        },
      });

      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to record time-off.'));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.badgeLabel}>STAFF & SCHEDULES</Text>
          <Text style={styles.title}>Barbers, Hours & Time-Off</Text>
        </View>

        <ErrorMessage message={staffMessage.error || ''} />
        {staffMessage.success ? (
          <Text style={styles.success} accessibilityRole="alert">
            {staffMessage.success}
          </Text>
        ) : null}

        {loadingBarbers ? (
          <LoadingIndicator message="Loading staff..." />
        ) : barbersError ? (
          <ErrorState
            message="Couldn't load the staff roster."
            onRetry={() => void refetchBarbers()}
          />
        ) : (
          <>
            <Text style={styles.sectionLabel}>Select Barber</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.barberScroll}>
              {barbers.map((b) => {
                const isSel = selectedBarberId === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.barberChip, isSel && styles.barberSelected]}
                    onPress={() => setSelectedBarberId(b.id)}
                  >
                    <Text style={[styles.barberText, isSel && styles.barberTextSel]}>{b.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Weekly hours of the selected barber; remounted per barber and revision. */}
            {selectedBarberId !== null &&
              (schedule.isError ? (
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyText}>Could not load the weekly hours.</Text>
                  <Button
                    title="Retry"
                    variant="secondary"
                    size="sm"
                    onPress={() => void schedule.refetch()}
                    style={{ marginTop: 8 }}
                  />
                </Card>
              ) : schedule.data && schedule.data.revision ? (
                <WeeklyHoursEditor
                  key={`${selectedBarberId}:${schedule.data.revision}`}
                  barberId={selectedBarberId}
                  schedule={schedule.data}
                  onMessage={setStaffMessage}
                />
              ) : (
                <LoadingIndicator message="Loading weekly hours..." />
              ))}

            {/* Time Off List */}
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Scheduled Absences</Text>
            {loadingTimeOff ? (
              <LoadingIndicator message="Fetching time-off..." />
            ) : timeOffError ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>Could not load scheduled time-off.</Text>
                <Button
                  title="Retry"
                  variant="secondary"
                  size="sm"
                  onPress={() => void refetchTimeOff()}
                  style={{ marginTop: 8 }}
                />
              </Card>
            ) : timeOffs.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No scheduled time-off for this barber.</Text>
              </Card>
            ) : (
              timeOffs.map((to) => (
                <Card key={to.id} style={styles.timeOffCard}>
                  <Text style={styles.dates}>
                    {to.startDate} → {to.endDate}
                  </Text>
                  {to.reason ? <Text style={styles.reason}>Reason: {to.reason}</Text> : null}
                </Card>
              ))
            )}

            {/* Add Time Off Form */}
            <Card style={styles.formCard} variant="goldBorder">
              <Text style={styles.formTitle}>Schedule New Time-Off</Text>
              <ErrorMessage message={error || ''} />

              <Input
                label="Start Date (YYYY-MM-DD) *"
                placeholder="2026-08-01"
                value={startDate}
                onChangeText={setStartDate}
              />

              <Input
                label="End Date (YYYY-MM-DD) *"
                placeholder="2026-08-05"
                value={endDate}
                onChangeText={setEndDate}
              />

              <Input
                label="Reason / Notes"
                placeholder="Annual leave, illness, or workshop"
                value={reason}
                onChangeText={setReason}
              />

              <Button
                title="Add Time-Off Record"
                variant="primary"
                loading={addTimeOffMutation.isPending}
                onPress={handleAddTimeOff}
                style={{ marginTop: 8 }}
              />
            </Card>

            <AddBarberCard
              onCreated={(barber) => setSelectedBarberId(barber.id)}
              onMessage={setStaffMessage}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  scrollContent: {
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
  sectionLabel: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  barberScroll: {
    maxHeight: 44,
    marginBottom: 12,
  },
  barberChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.obsidian.card,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    marginRight: 8,
  },
  barberSelected: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  barberText: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  barberTextSel: {
    color: colors.obsidian.bg,
    fontWeight: '700',
  },
  emptyCard: {
    padding: 16,
    marginBottom: 16,
  },
  emptyText: {
    color: colors.text.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  timeOffCard: {
    marginBottom: 8,
  },
  dates: {
    color: colors.gold.main,
    fontSize: 14,
    fontWeight: '700',
  },
  reason: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 4,
  },
  formCard: {
    marginTop: 16,
    padding: 16,
  },
  formTitle: {
    color: colors.gold.main,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  success: {
    color: colors.status.approved,
    fontSize: 13,
    marginBottom: 12,
  },
});
