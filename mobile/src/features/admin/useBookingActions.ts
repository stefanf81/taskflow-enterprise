import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  useUpdateAppointmentStatus,
  useDeleteAppointment,
} from '../../core/appointments/useAppointments';
import { getApiErrorMessage } from '../../utils/errors';
import type { AppointmentItem } from '../../types/api';

interface Feedback {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

/**
 * What the owner can do to one booking: approve, decline, cancel (after a confirmation). Used by
 * the dashboard list and the calendar, so both lock a booking while its request is in flight and
 * report the same messages.
 */
export function useBookingActions({ showSuccess, showError }: Feedback) {
  // The stable functions, not the mutation results: those change identity at every state
  // (idle, pending, success), and every row's handlers with them (BENCHMARKS.md §79).
  const { mutateAsync: updateStatus } = useUpdateAppointmentStatus();
  const { mutateAsync: cancelAppointment } = useDeleteAppointment();
  const actionLocks = useRef(new Set<number>());
  const [busyIds, setBusyIds] = useState<number[]>([]);

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

  const approve = (id: number) =>
    runAction(
      id,
      () => updateStatus({ id, status: 'APPROVED' }),
      'Appointment APPROVED! Client notification email queued.',
      'Failed to approve appointment.',
    );

  const deny = (id: number) =>
    runAction(
      id,
      () => updateStatus({ id, status: 'DENIED' }),
      'Appointment DECLINED. Client notification email queued.',
      'Failed to decline appointment.',
    );

  // Takes the row's booking rather than finding it in a list, which changes on every refetch.
  const cancel = (appointment: AppointmentItem) => {
    const id = appointment.id;
    if (
      actionLocks.current.has(id) ||
      (appointment.status !== 'PENDING' && appointment.status !== 'APPROVED')
    )
      return;
    Alert.alert('Cancel Booking', 'Are you sure you want to cancel this booking?', [
      { text: 'Keep Booking', style: 'cancel' },
      {
        text: 'Cancel Booking',
        style: 'destructive',
        onPress: () => {
          void runAction(
            id,
            () => cancelAppointment(id),
            'Booking cancelled.',
            'Failed to cancel booking.',
          );
        },
      },
    ]);
  };

  return { busyIds, approve, deny, cancel };
}
