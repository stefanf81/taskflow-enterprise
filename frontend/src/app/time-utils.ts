/** Time and appointment utilities for the Angular web client. */

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
  const [hourPart = '', minutePart = ''] = time24.split(':');
  const hours = parseInt(hourPart, 10);
  const minutes = minutePart || '00';
  if (isNaN(hours)) return time24;
  const amPm = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes} ${amPm}`;
}

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [hoursPart = '', minutesPart = ''] = timeStr.split(':');
  const hours = parseInt(hoursPart, 10) || 0;
  const minutes = parseInt(minutesPart, 10) || 0;
  return hours * 60 + minutes;
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

/**
 * Formats a date-only string (YYYY-MM-DD) in the LOCAL timezone.
 *
 * Unlike the Angular `date` pipe — which parses date-only strings as UTC
 * midnight and can shift the displayed day back by one in negative-offset
 * zones (e.g. US/EU after 8 PM EDT) — appending `T00:00:00` parses as local
 * midnight, so the rendered day always matches the stored date.
 */
// One shared formatter: toLocaleDateString builds a new Intl.DateTimeFormat on every call, and this
// runs for every row of the admin, customer and schedule lists on each change detection pass.
const LOCAL_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function formatLocalDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return LOCAL_DATE_FORMAT.format(date);
}

/**
 * How far ahead a booking may be made. Mirrors the backend rule ("at most 90
 * days ahead"); the single place the web client states it.
 */
export const MAX_BOOKING_DAYS_AHEAD = 90;

/** Formats a Date as YYYY-MM-DD from its LOCAL components (never the UTC-shifted `toISOString`). */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Whether `dateStr` (YYYY-MM-DD) lies within [today, today + MAX_BOOKING_DAYS_AHEAD]. */
export function isBookableDate(dateStr: string, now: Date): boolean {
  if (!dateStr) return false;
  const limit = new Date(now);
  limit.setDate(limit.getDate() + MAX_BOOKING_DAYS_AHEAD);
  return dateStr >= toLocalDateString(now) && dateStr <= toLocalDateString(limit);
}

/** Whether a same-day `HH:mm` slot has already started (so the server would reject it as past). */
export function isSlotInPast(dateStr: string, slot: string, now: Date): boolean {
  if (!dateStr || !slot) return false;
  const today = toLocalDateString(now);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return parseTimeToMinutes(slot) <= now.getHours() * 60 + now.getMinutes();
}

/** Milliseconds until the next local midnight (the moment "today" changes). */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function isOverdue(input: { bookingDate?: string } | string): boolean {
  if (!input) return false;
  const bookingDate = typeof input === 'string' ? input : input.bookingDate;
  if (!bookingDate) return false;

  return bookingDate < toLocalDateString(new Date());
}
