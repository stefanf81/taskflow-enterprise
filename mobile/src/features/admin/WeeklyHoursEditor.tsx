import React, { useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '../../components/common/Card';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { usePreviewBarberSchedule, useUpdateBarberSchedule } from '../../core/barbers/useBarbers';
import type { BarberScheduleResponse, ScheduleDay, SchedulePreviewResponse } from '../../types/api';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

interface DayDraft {
  dayOfWeek: number;
  open: boolean;
  opens: string;
  closes: string;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toDraft(schedule: BarberScheduleResponse): DayDraft[] {
  return WEEKDAYS.map((_, index) => {
    const dayOfWeek = index + 1;
    const shift = schedule.days.find((day) => day.dayOfWeek === dayOfWeek);
    return shift
      ? { dayOfWeek, open: true, opens: shift.opens, closes: shift.closes }
      : { dayOfWeek, open: false, opens: '09:00', closes: '17:00' };
  });
}

function invalidDay(draft: DayDraft[]): DayDraft | undefined {
  return draft.find(
    (day) => day.open && (!HH_MM.test(day.opens) || !HH_MM.test(day.closes) || !(day.opens < day.closes)),
  );
}

interface WeeklyHoursEditorProps {
  barberId: number;
  /** The loaded schedule; the parent remounts the editor (key) for a new barber or revision. */
  schedule: BarberScheduleResponse;
  onMessage: (message: { error?: string; success?: string }) => void;
}

/**
 * The selected barber's weekly hours (mobile twin of the web editor). A change is previewed
 * first: the server counts the upcoming bookings outside the new hours, and saving them away
 * needs an explicit confirmation. The revision of the schedule (and of the preview) travels with
 * both calls, so a change made meanwhile is refused (409) and the schedule reloaded.
 */
export const WeeklyHoursEditor: React.FC<WeeklyHoursEditorProps> = ({
  barberId,
  schedule,
  onMessage,
}) => {
  const [draft, setDraft] = useState<DayDraft[]>(() => toDraft(schedule));
  const [preview, setPreview] = useState<{ key: string; result: SchedulePreviewResponse } | null>(
    null,
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const previewMutation = usePreviewBarberSchedule();
  const updateMutation = useUpdateBarberSchedule();
  const busy = previewMutation.isPending || updateMutation.isPending;

  const days: ScheduleDay[] = draft
    .filter((day) => day.open)
    .map(({ dayOfWeek, opens, closes }) => ({ dayOfWeek, opens, closes }));
  const draftKey = JSON.stringify(days);
  const unchanged = JSON.stringify(schedule.days) === draftKey;
  const invalid = invalidDay(draft);
  const currentPreview = preview && preview.key === draftKey ? preview.result : null;

  const updateDay = (dayOfWeek: number, patch: Partial<DayDraft>) => {
    setDraft((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    );
    setConfirmCancel(false);
  };

  const handleReview = () => {
    if (invalid || unchanged || busy) return;
    const key = draftKey;
    onMessage({});
    previewMutation.mutate(
      {
        barberId,
        data: { days, expectedRevision: schedule.revision, cancelConflictingAppointments: false },
      },
      {
        onSuccess: (result) => {
          setPreview({ key, result });
          setConfirmCancel(false);
        },
        onError: (err) =>
          onMessage({ error: getApiErrorMessage(err, 'Failed to preview the schedule change.') }),
      },
    );
  };

  const handleSave = () => {
    if (!currentPreview || busy) return;
    if (currentPreview.conflictCount > 0 && !confirmCancel) return;
    updateMutation.mutate(
      {
        barberId,
        data: {
          days,
          expectedRevision: schedule.revision,
          expectedConflicts: currentPreview.conflictsRevision,
          cancelConflictingAppointments: currentPreview.conflictCount > 0,
        },
      },
      {
        onSuccess: () => onMessage({ success: 'Weekly schedule updated.' }),
        onError: (err) =>
          onMessage({ error: getApiErrorMessage(err, 'Failed to update the weekly schedule.') }),
        // Like the web editor: whatever the outcome, the preview is spent. A refused save (409:
        // the hours or the affected bookings changed meanwhile) must be reviewed again, even when
        // the reloaded schedule is unchanged and this editor stays mounted.
        onSettled: () => {
          setPreview(null);
          setConfirmCancel(false);
        },
      },
    );
  };

  return (
    <Card style={styles.card} variant="goldBorder">
      <Text style={styles.title}>Weekly Hours</Text>
      {draft.map((day) => (
        <View key={day.dayOfWeek} style={styles.dayRow}>
          <View style={styles.dayToggle}>
            <Switch
              value={day.open}
              disabled={busy}
              onValueChange={(open) => updateDay(day.dayOfWeek, { open })}
              accessibilityLabel={`${WEEKDAYS[day.dayOfWeek - 1]} working`}
            />
            <Text style={styles.dayName}>{WEEKDAYS[day.dayOfWeek - 1]}</Text>
          </View>
          {day.open ? (
            <View style={styles.times}>
              <Input
                placeholder="09:00"
                accessibilityLabel={`${WEEKDAYS[day.dayOfWeek - 1]} opens`}
                value={day.opens}
                editable={!busy}
                onChangeText={(opens) => updateDay(day.dayOfWeek, { opens })}
                style={styles.timeInput}
              />
              <Text style={styles.to}>to</Text>
              <Input
                placeholder="17:00"
                accessibilityLabel={`${WEEKDAYS[day.dayOfWeek - 1]} closes`}
                value={day.closes}
                editable={!busy}
                onChangeText={(closes) => updateDay(day.dayOfWeek, { closes })}
                style={styles.timeInput}
              />
            </View>
          ) : (
            <Text style={styles.closed}>Not working</Text>
          )}
        </View>
      ))}

      {invalid && (
        <Text style={styles.error}>
          {WEEKDAYS[invalid.dayOfWeek - 1]}: use HH:mm and open before closing.
        </Text>
      )}

      {currentPreview && (
        <View style={styles.preview}>
          {currentPreview.conflictCount === 0 ? (
            <Text style={styles.ok}>No upcoming bookings fall outside the new hours.</Text>
          ) : (
            <>
              <Text style={styles.warning}>
                {currentPreview.conflictCount} upcoming booking(s) fall outside the new hours. Saving
                cancels them and queues an email to each customer.
              </Text>
              <TouchableOpacity
                style={styles.confirmRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmCancel }}
                onPress={() => setConfirmCancel(!confirmCancel)}
              >
                <View style={[styles.checkbox, confirmCancel && styles.checkboxOn]} />
                <Text style={styles.confirmText}>
                  Cancel these {currentPreview.conflictCount} booking(s)
                </Text>
              </TouchableOpacity>
            </>
          )}
          <Button
            title={
              currentPreview.conflictCount > 0
                ? `Save and cancel ${currentPreview.conflictCount} booking(s)`
                : 'Save weekly hours'
            }
            variant="primary"
            loading={updateMutation.isPending}
            disabled={busy || (currentPreview.conflictCount > 0 && !confirmCancel)}
            onPress={handleSave}
            style={styles.button}
          />
        </View>
      )}

      <View style={styles.actions}>
        <Button
          title="Review changes"
          variant="secondary"
          size="sm"
          loading={previewMutation.isPending}
          disabled={busy || unchanged || !!invalid || !!currentPreview}
          onPress={handleReview}
          style={styles.action}
        />
        <Button
          title="Discard changes"
          variant="secondary"
          size="sm"
          disabled={busy || unchanged}
          onPress={() => {
            setDraft(toDraft(schedule));
            setPreview(null);
            setConfirmCancel(false);
          }}
          style={styles.action}
        />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
  },
  title: {
    color: colors.gold.main,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  dayRow: {
    marginBottom: 8,
  },
  dayToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayName: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  times: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeInput: {
    minWidth: 70,
  },
  to: {
    color: colors.text.secondary,
    fontSize: 12,
  },
  closed: {
    color: colors.text.muted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  error: {
    color: colors.status.denied,
    fontSize: 12,
    marginTop: 8,
  },
  preview: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  ok: {
    color: colors.status.approved,
    fontSize: 12,
  },
  warning: {
    color: colors.status.pending,
    fontSize: 12,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.gold.main,
  },
  checkboxOn: {
    backgroundColor: colors.gold.main,
  },
  confirmText: {
    color: colors.text.primary,
    fontSize: 12,
  },
  button: {
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  action: {
    flex: 1,
  },
});
