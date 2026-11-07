/** How long the object URL stays valid; revoking it at once can abort the download (Safari). */
const REVOKE_AFTER_MS = 10_000;

/**
 * Offers text as a file download. Returns false where the browser cannot (prerendering, or a
 * runtime without object URLs), so the caller can say so instead of failing silently.
 */
export function downloadTextFile(content: string, filename: string, type: string): boolean {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return false;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  // Firefox only follows a click on an anchor that is part of the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return true;
}

/** The iCalendar MIME type both calendar exports use. */
export const ICS_MIME_TYPE = 'text/calendar;charset=utf-8';
