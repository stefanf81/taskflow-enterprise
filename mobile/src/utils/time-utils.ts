/**
 * Format "HH:MM" 24h time string to "h:MM AM/PM" 12h format.
 */
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

/**
 * Parse "HH:MM" to total minutes from midnight.
 */
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

/**
 * Format total minutes back to "HH:MM" 24h string.
 */
export function formatMinutesToTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const hrStr = hours < 10 ? '0' + hours : hours.toString();
  const minStr = minutes < 10 ? '0' + minutes : minutes.toString();
  return `${hrStr}:${minStr}`;
}

/**
 * Calculate estimated end time given a start time and duration in minutes.
 * Returns "HH:MM" 24h format.
 */
export function computeEstimatedEndTime(
  startTime: string,
  durationMinutes: number,
): string {
  if (!startTime || !durationMinutes) return '';
  const startMin = parseTimeToMinutes(startTime);
  const endMin = startMin + durationMinutes;
  return formatMinutesToTimeString(endMin);
}

/**
 * Check if an appointment's date is before today (local date).
 */
export function isOverdue(
  bookingDate: string,
): boolean {
  if (!bookingDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const apptDate = new Date(bookingDate + 'T00:00:00');
  return apptDate < today;
}
