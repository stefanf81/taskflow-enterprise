import { SLOT_HOLDING_STATUSES } from '@taskflow/domain/src/calendar';
import type { AppointmentItem } from '../../types/api';

/** One day of the calendar: its date and the bookings that hold a slot, earliest first. */
export interface AgendaDay {
  date: string;
  items: AppointmentItem[];
}

/**
 * Lays bookings out per day for the owner's calendar. Only bookings that hold a slot are listed
 * (a denied or cancelled one has released it); `barber` narrows them to one barber, `null` keeps
 * all. Every date of the range gets its day, so an empty day reads as empty, not as missing.
 */
export function buildAgenda(
  appointments: readonly AppointmentItem[],
  dates: readonly string[],
  barber: string | null,
): AgendaDay[] {
  const byDate = new Map<string, AppointmentItem[]>(dates.map((date) => [date, []]));
  for (const appointment of appointments) {
    if (!SLOT_HOLDING_STATUSES.includes(appointment.status)) continue;
    if (barber !== null && appointment.barberName !== barber) continue;
    byDate.get(appointment.bookingDate)?.push(appointment);
  }
  return dates.map((date) => ({
    date,
    items: (byDate.get(date) ?? []).sort(
      (a, b) => a.bookingTime.localeCompare(b.bookingTime) || a.id - b.id,
    ),
  }));
}
