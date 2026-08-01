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

/**
 * Formats a date-only string (YYYY-MM-DD) in the LOCAL timezone.
 *
 * Unlike the Angular `date` pipe — which parses date-only strings as UTC
 * midnight and can shift the displayed day back by one in negative-offset
 * zones (e.g. US/EU after 8 PM EDT) — appending `T00:00:00` parses as local
 * midnight, so the rendered day always matches the stored date.
 */
export function formatLocalDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function isOverdue(input: { bookingDate?: string } | string): boolean {
  if (!input) return false;
  const bookingDate = typeof input === 'string' ? input : input.bookingDate;
  if (!bookingDate) return false;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return bookingDate < todayStr;
}
