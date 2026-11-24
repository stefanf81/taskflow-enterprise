import {
  type OpeningHours,
  type ShopRules,
  addDays,
  hoursOn,
  isoWeekday,
  parseLocalDate,
  parseTimeToMinutes,
} from '@taskflow/domain';
import { AppointmentResponse } from '../../types/api';

/** The calendar shows one day (a column per barber) or one week (a column per day). */
export type CalendarView = 'day' | 'week';

/** Inclusive `YYYY-MM-DD` bounds, as `GET /api/v1/appointments?from=&to=` takes them. */
export interface CalendarRange {
  from: string;
  to: string;
}

/** Statuses that hold a slot. A denied or cancelled booking has released it, so it is not drawn. */
export const SLOT_HOLDING_STATUSES: readonly string[] = ['PENDING', 'APPROVED'];

/** The hours shown when the shop's opening hours say nothing (closed all week, not loaded). */
const FALLBACK_HOURS: Pick<OpeningHours, 'opens' | 'closes'> = { opens: '09:00', closes: '17:00' };

/** `date` moved by `days` calendar days. */
export function shiftDate(date: string, days: number): string {
  return addDays(parseLocalDate(date), days);
}

/** The Monday of the ISO week `date` falls in. */
export function weekStart(date: string): string {
  return shiftDate(date, 1 - isoWeekday(parseLocalDate(date)));
}

/** The days a view covers around `anchor`: that day, or the Monday-to-Sunday week it is in. */
export function rangeOf(view: CalendarView, anchor: string): CalendarRange {
  if (view === 'day') return { from: anchor, to: anchor };
  const monday = weekStart(anchor);
  return { from: monday, to: shiftDate(monday, 6) };
}

/** Every date of a range, in order. */
export function datesOf(range: CalendarRange): string[] {
  const dates: string[] = [];
  for (let date = range.from; date <= range.to && dates.length < 366; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** How far the previous/next buttons move the anchor. */
export function stepOf(view: CalendarView): number {
  return view === 'day' ? 1 : 7;
}

/** `9` -> `9 AM`, `13` -> `1 PM`. */
export function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** The hour a `HH:mm` start time falls in. */
export function hourOf(time: string): number {
  return Math.floor(parseTimeToMinutes(time) / 60);
}

/**
 * The hour rows of the grid: from the earliest opening to the latest closing of the dates shown
 * (a closing at 17:30 still gets the 17:00 row), widened to hold any booking outside those hours
 * (an owner who changed the hours still sees the older bookings). The server's hourly grid skips
 * lunch, so the hour is kept: an empty row is the lunch break, not a gap in the data.
 */
export function calendarHours(
  rules: ShopRules,
  dates: readonly string[],
  appointments: readonly Pick<AppointmentResponse, 'bookingTime'>[],
): number[] {
  const opening = dates
    .map((date) => hoursOn(rules, isoWeekday(parseLocalDate(date))))
    .filter((hours): hours is OpeningHours => hours !== undefined);
  if (opening.length === 0) opening.push({ dayOfWeek: 0, ...FALLBACK_HOURS });

  let first = Math.min(...opening.map((hours) => hourOf(hours.opens)));
  let last = Math.max(
    ...opening.map((hours) => Math.ceil(parseTimeToMinutes(hours.closes) / 60) - 1),
  );
  for (const appointment of appointments) {
    const hour = hourOf(appointment.bookingTime);
    first = Math.min(first, hour);
    last = Math.max(last, hour);
  }
  return Array.from({ length: Math.max(last - first + 1, 0) }, (_, index) => first + index);
}

/** One cell of the grid: the bookings starting in that hour, earliest first. */
export type CalendarCell = readonly AppointmentResponse[];

/** A row of the grid: an hour and one cell per column. */
export interface CalendarRow {
  hour: number;
  cells: readonly CalendarCell[];
}

/**
 * Lays the bookings out as rows (hours) by columns. `columnOf` gives the column key a booking
 * belongs to (its barber in the day view, its date in the week view); a booking whose key is not
 * among `columnKeys` is left out, so a barber filter is just a shorter key list.
 */
export function buildGrid(
  appointments: readonly AppointmentResponse[],
  columnKeys: readonly string[],
  columnOf: (appointment: AppointmentResponse) => string,
  hours: readonly number[],
): CalendarRow[] {
  const slots = new Map<string, AppointmentResponse[]>();
  for (const appointment of appointments) {
    const key = `${hourOf(appointment.bookingTime)}|${columnOf(appointment)}`;
    const cell = slots.get(key);
    if (cell) cell.push(appointment);
    else slots.set(key, [appointment]);
  }
  return hours.map((hour) => ({
    hour,
    cells: columnKeys.map((key) =>
      (slots.get(`${hour}|${key}`) ?? []).sort(
        (a, b) => a.bookingTime.localeCompare(b.bookingTime) || a.id - b.id,
      ),
    ),
  }));
}
