/**
 * Shared time-formatting utilities used by App, AdminDashboard, and CustomerPortal.
 */

/** Convert 24-hour "HH:MM" string to 12-hour "h:MM AM/PM" display. */
export function formatTime12Hour(time24: string): string {
  if (!time24) return '';
  try {
    const parts = time24.split(':');
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  } catch {
    return time24;
  }
}

/** Check if an appointment's booking date is in the past. */
export function isOverdue(appt: { bookingDate?: string }): boolean {
  if (!appt.bookingDate) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  return appt.bookingDate < todayStr;
}
