/**
 * Time helpers of the web client: the ones both clients share come from `@taskflow/domain`
 * (re-exported here so the app keeps one import point); the rest format for the browser.
 */
import { parseLocalDate, type WallClock } from '@taskflow/domain';

export {
  DEFAULT_TIME_SLOTS,
  type WallClock,
  computeEstimatedEndTime,
  formatMinutesToTimeString,
  formatTime12Hour,
  isOverdue,
  isSlotInPast,
  parseLocalDate,
  parseTimeToMinutes,
  shopWallClock,
  toLocalDateString,
} from '@taskflow/domain';

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
  const date = parseLocalDate(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return LOCAL_DATE_FORMAT.format(date);
}

/** Milliseconds until the next local midnight (the moment "today" changes). */
export function msUntilNextLocalMidnight(now: WallClock): number {
  if (now instanceof Date) {
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return next.getTime() - now.getTime();
  }
  const elapsedMs =
    ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 +
    now.getMilliseconds();
  return 86_400_000 - elapsedMs;
}
