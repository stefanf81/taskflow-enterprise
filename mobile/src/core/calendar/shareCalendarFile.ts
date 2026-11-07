import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** iCalendar, so the share sheet offers apps that import events (Calendar, Google Calendar). */
const ICS_MIME_TYPE = 'text/calendar';
const ICS_UTI = 'com.apple.ical.ics';

/**
 * Writes the server's .ics export to the app's cache and opens the system share sheet with the
 * file (not its text): a calendar app imports it as an event. Resolves false when this device
 * cannot share files, so the caller can say so; a write or share failure rejects.
 */
export async function shareCalendarFile(content: string, filename: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '') || 'appointment.ics';
  const file = new File(Paths.cache, safeName.endsWith('.ics') ? safeName : `${safeName}.ics`);
  await file.write(content);
  await Sharing.shareAsync(file.uri, {
    mimeType: ICS_MIME_TYPE,
    UTI: ICS_UTI,
    dialogTitle: 'Add to calendar',
  });
  return true;
}
