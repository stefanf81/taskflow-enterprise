/** Time and appointment utilities for the React Native mobile client. */

export const DEFAULT_TIME_SLOTS: readonly string[] = [
  '09:00',
  '10:00',
  '11:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
];

export function formatTime12Hour(time24: string): string {
  if (!time24) return '';
  try {
    const parts = time24.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    if (isNaN(hours)) return time24;
    const amPm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes} ${amPm}`;
  } catch {
    return time24;
  }
}

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  try {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours * 60 + minutes;
  } catch {
    return 0;
  }
}

export function formatMinutesToTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const hrStr = hours < 10 ? '0' + hours : hours.toString();
  const minStr = minutes < 10 ? '0' + minutes : minutes.toString();
  return `${hrStr}:${minStr}`;
}

export function computeEstimatedEndTime(startTime: string, durationMinutes: number): string {
  if (!startTime || !durationMinutes) return '';
  const startMin = parseTimeToMinutes(startTime);
  return formatMinutesToTimeString(startMin + durationMinutes);
}

export function isOverdue(input: { bookingDate?: string } | string): boolean {
  if (!input) return false;
  const bookingDate = typeof input === 'string' ? input : input.bookingDate;
  if (!bookingDate) return false;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return bookingDate < todayStr;
}

/**
 * The shop's wall clock as a `Date` whose LOCAL components (getHours(), getDate(), ...) read the
 * time in the shop's time zone, so the local-component helpers below decide "today", "past" and
 * "too far ahead" the way the server does (it judges bookings in the shop zone, not the phone's).
 * The result is a shifted stand-in for display and comparison only, never an instant to send.
 *
 * Without a usable zone (not loaded yet, unknown id, no Intl time-zone support) the phone's own
 * clock is returned: the server stays authoritative and rejects what this guesses wrong.
 */
export function shopWallClock(
  timeZone: string | null | undefined,
  instant: Date = new Date(),
): Date {
  if (!timeZone) return instant;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value);
    const wall = new Date(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
      instant.getMilliseconds(),
    );
    return Number.isNaN(wall.getTime()) ? instant : wall;
  } catch {
    return instant;
  }
}

/** Format a Date as a local-timezone `YYYY-MM-DD` string.
 *
 * Do NOT use `toISOString().split('T')[0]` for calendar dates: it converts to
 * UTC first, which can shift the date by a day near midnight in any timezone
 * ahead of UTC (e.g. 2026-08-01 23:30 CEST becomes "2026-08-01" but the local
 * date is August 2nd). This helper mirrors the local getters used by isOverdue.
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface UpcomingDay {
  dateStr: string;
  dayName: string;
  dayNum: number;
  monthName: string;
}

/** Compute the next `count` operating days (excluding Sundays) starting at `from`.
 *
 * Pure helper — inject a fixed Date for deterministic tests. Dates are built
 * from local-timezone getters so the returned `dateStr` matches the calendar
 * the user actually sees (no UTC drift).
 */
export function getUpcomingDays(from: Date, count = 7): UpcomingDay[] {
  const days: UpcomingDay[] = [];
  let offset = 0;
  while (days.length < count && offset < 14) {
    const nextDate = new Date(from);
    nextDate.setDate(from.getDate() + offset);
    if (nextDate.getDay() !== 0) {
      days.push({
        dateStr: toLocalDateString(nextDate),
        dayName: nextDate.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: nextDate.getDate(),
        monthName: nextDate.toLocaleDateString('en-US', { month: 'short' }),
      });
    }
    offset++;
  }
  return days;
}

// ---------------------------------------------------------------------------
// Booking-window helpers (server rules: future only, at most 90 days ahead,
// hourly grid). Pure and clock-injected so they are deterministic in tests.
// Times are compared in the device's local time; the server remains the
// authority for the shop's own time zone and surfaces its message on 400.
// ---------------------------------------------------------------------------

/** Furthest day (inclusive, counted from today) the server accepts a booking for. */
export const MAX_BOOKING_DAYS_AHEAD = 90;

export const PAST_SLOT_MESSAGE = 'That time has already passed. Please choose a later slot.';
export const OUTSIDE_WINDOW_MESSAGE = `Bookings can be made at most ${MAX_BOOKING_DAYS_AHEAD} days ahead.`;

/** Local `YYYY-MM-DD` of the last bookable day relative to `now`. */
export function getLastBookableDate(now: Date, maxDaysAhead = MAX_BOOKING_DAYS_AHEAD): string {
  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate() + maxDaysAhead);
  return toLocalDateString(last);
}

/** True when `dateStr` is today or later and no more than `maxDaysAhead` days out. */
export function isWithinBookingWindow(
  dateStr: string,
  now: Date,
  maxDaysAhead = MAX_BOOKING_DAYS_AHEAD,
): boolean {
  if (!dateStr) return false;
  return dateStr >= toLocalDateString(now) && dateStr <= getLastBookableDate(now, maxDaysAhead);
}

/** True when the slot starts at or before `now` (a booking must be strictly in the future). */
export function isSlotInPast(dateStr: string, time24: string, now: Date): boolean {
  if (!dateStr || !time24) return false;
  const today = toLocalDateString(now);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return parseTimeToMinutes(time24) <= now.getHours() * 60 + now.getMinutes();
}

/** The subset of `slots` that are still in the future on `dateStr` (empty outside the window). */
export function getSelectableSlots(
  dateStr: string,
  now: Date,
  slots: readonly string[] = DEFAULT_TIME_SLOTS,
): string[] {
  if (!isWithinBookingWindow(dateStr, now)) return [];
  return slots.filter((slot) => !isSlotInPast(dateStr, slot, now));
}

/** Why a date/time pair cannot be booked, or null when it can. */
export function getSlotValidationError(dateStr: string, time24: string, now: Date): string | null {
  if (!dateStr || !time24) return 'Please select a date and time slot.';
  if (!isWithinBookingWindow(dateStr, now)) {
    return dateStr < toLocalDateString(now) ? PAST_SLOT_MESSAGE : OUTSIDE_WINDOW_MESSAGE;
  }
  if (isSlotInPast(dateStr, time24, now)) return PAST_SLOT_MESSAGE;
  return null;
}

export interface SlotSelection {
  date: string;
  time: string;
}

/** First day (in `dates` order) that still has a selectable slot, with its first slot. */
export function getFirstSelectableSlot(
  dates: readonly string[],
  now: Date,
  slots: readonly string[] = DEFAULT_TIME_SLOTS,
): SlotSelection | null {
  for (const date of dates) {
    const time = getSelectableSlots(date, now, slots)[0];
    if (time !== undefined) return { date, time };
  }
  return null;
}

/**
 * Keep `current` when it is still bookable; otherwise prefer the first future
 * slot on the same day, then the first selectable slot of the offered days.
 * Returns null when nothing is selectable (callers keep their state).
 */
export function resolveBookableSelection(
  current: SlotSelection,
  dates: readonly string[],
  now: Date,
  slots: readonly string[] = DEFAULT_TIME_SLOTS,
): SlotSelection | null {
  if (
    dates.includes(current.date) &&
    getSlotValidationError(current.date, current.time, now) === null
  ) {
    return current;
  }
  if (dates.includes(current.date)) {
    const sameDay = getSelectableSlots(current.date, now, slots)[0];
    if (sameDay !== undefined) return { date: current.date, time: sameDay };
  }
  return getFirstSelectableSlot(dates, now, slots);
}
