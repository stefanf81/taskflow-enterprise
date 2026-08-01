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

export interface UpcomingDay {
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
