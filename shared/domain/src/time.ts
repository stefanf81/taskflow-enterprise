/**
 * Clock and `HH:mm` helpers. Dates are `YYYY-MM-DD` strings and times `HH:mm`, both wall-clock
 * values in the shop's time zone, exactly as the API sends them. Every "now" is passed in, so the
 * callers decide which clock (the shop's, see {@link shopWallClock}) and tests can fix it.
 */

/** The bookable start times of a day (the server's hourly grid, lunch at 12:00 excluded). */
export const DEFAULT_TIME_SLOTS: readonly string[] = [
  '09:00',
  '10:00',
  '11:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
];

/** `13:30` -> `1:30 PM`; anything unparseable comes back unchanged. */
export function formatTime12Hour(time24: string): string {
  if (!time24) return '';
  const [hourPart = '', minutePart = ''] = time24.split(':');
  const hours = parseInt(hourPart, 10);
  if (isNaN(hours)) return time24;
  const amPm = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${minutePart || '00'} ${amPm}`;
}

/** `HH:mm` -> minutes since midnight (missing parts count as 0). */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [hoursPart = '', minutesPart = ''] = timeStr.split(':');
  return (parseInt(hoursPart, 10) || 0) * 60 + (parseInt(minutesPart, 10) || 0);
}

/** Minutes since midnight -> `HH:mm` (wraps past midnight). */
export function formatMinutesToTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** End of a booking that starts at `startTime` and lasts `durationMinutes` (`''` when unknown). */
export function computeEstimatedEndTime(startTime: string, durationMinutes: number): string {
  if (!startTime || !durationMinutes) return '';
  return formatMinutesToTimeString(parseTimeToMinutes(startTime) + durationMinutes);
}

/**
 * One formatter per zone. Building an `Intl.DateTimeFormat` costs about ten times as much as using
 * one (55 vs 5.6 µs per call measured in Node), and the admin and customer lists ask for the shop's
 * "now" several times per row on every change detection. Only formatters that could be built are
 * kept, so an unknown zone still throws (and falls back) every time; the shop has a single zone.
 */
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    wallClockFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The shop's wall clock as a `Date` whose LOCAL components (getHours(), getDate(), ...) read the
 * time in the shop's time zone, so the local-component helpers here decide "today", "past" and
 * "too far ahead" the way the server does (it judges bookings in the shop zone, not the
 * visitor's). The result is a shifted stand-in for display and comparison only, never an instant
 * to send anywhere.
 *
 * Without a usable zone (not loaded yet, unknown id, no Intl time-zone support) the device's own
 * clock is returned: the server stays authoritative and rejects what this guesses wrong.
 */
export function shopWallClock(timeZone: string | null | undefined, instant: Date = new Date()): Date {
  if (!timeZone) return instant;
  try {
    const parts = wallClockFormatter(timeZone).formatToParts(instant);
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

/**
 * A Date as `YYYY-MM-DD` from its LOCAL components. Never `toISOString().split('T')[0]`: that
 * converts to UTC first and shifts the day near midnight in every zone ahead of UTC.
 */
export function toLocalDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whether `dateStr` is a real Gregorian `YYYY-MM-DD` calendar date (rejects e.g. `2026-02-31`). */
export function isValidLocalDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [yearStr = '', monthStr = '', dayStr = ''] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysInMonth;
}

/** `YYYY-MM-DD` as a local-midnight Date (an invalid Date for anything else, including rollover dates). */
export function parseLocalDate(dateStr: string): Date {
  if (!isValidLocalDate(dateStr)) return new Date(NaN);
  return new Date(`${dateStr}T00:00:00`);
}

/** `YYYY-MM-DD` `days` calendar days after `date` (local components, DST-safe). */
export function addDays(date: Date, days: number): string {
  return toLocalDateString(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/** Whether a slot has already started at `now`: a booking must lie strictly in the future. */
export function isSlotInPast(dateStr: string, time24: string, now: Date): boolean {
  if (!dateStr || !time24) return false;
  const today = toLocalDateString(now);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return parseTimeToMinutes(time24) <= now.getHours() * 60 + now.getMinutes();
}

/** Whether a booking date lies before today (a PENDING one is then overdue for the shop). */
export function isOverdue(input: { bookingDate?: string } | string, now: Date = new Date()): boolean {
  if (!input) return false;
  const bookingDate = typeof input === 'string' ? input : input.bookingDate;
  return !!bookingDate && bookingDate < toLocalDateString(now);
}
