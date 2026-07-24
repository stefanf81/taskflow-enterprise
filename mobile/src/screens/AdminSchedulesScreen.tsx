import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Card } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { LoadingIndicator } from '../components/common/LoadingIndicator';
import { useBarbers, useBarberTimeOff, useAddTimeOff } from '../hooks/useBarbers';
import { colors } from '../theme/colors';

export const AdminSchedulesScreen: React.FC = () => {
  const { data: barbers = [], isLoading: loadingBarbers } = useBarbers();
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);

  const { data: timeOffs = [], isLoading: loadingTimeOff } = useBarberTimeOff(selectedBarberId);
  const addTimeOffMutation = useAddTimeOff();

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
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : err instanceof Error
            ? err.message
            : 'Failed to record time-off.';
      setError(message || 'Failed to record time-off.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.badgeLabel}>STAFF & SCHEDULES</Text>
          <Text style={styles.title}>Barber Time-Off</Text>
        </View>

        {loadingBarbers ? (
          <LoadingIndicator message="Loading staff..." />
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

            {/* Time Off List */}
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Scheduled Absences</Text>
            {loadingTimeOff ? (
              <LoadingIndicator message="Fetching time-off..." />
            ) : timeOffs.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No scheduled time-off for this barber.</Text>
              </Card>
            ) : (
              timeOffs.map((to, idx) => (
                <Card key={idx} style={styles.timeOffCard}>
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
});
