/**
 * Time helpers of the web client: the ones both clients share come from `@taskflow/domain`
 * (re-exported here so the app keeps one import point); the rest format for the browser.
 */
import { parseLocalDate, shopWallClock, toLocalDateString } from '@taskflow/domain';

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

/** 26 h: more than the longest possible calendar day, so midnight is always inside the search. */
const MIDNIGHT_SEARCH_MINUTES = 26 * 60;

/**
 * Milliseconds until the next midnight of `timeZone` (the moment "today" changes there), or of
 * the device's own clock when the zone is not known yet.
 *
 * A day is not always 24 hours: where DST is observed, the transition day is 23 or 25 hours long,
 * so "24 h minus the time on the clock" misses midnight by the offset change — the wizard would
 * either hold on to yesterday's "today" for an hour or re-arm an hour early. `Date.setHours` gets
 * this right for the device's zone; for the shop's, the first minute that belongs to another
 * calendar day is found by bisection (about a dozen reads of a cached formatter, once a day).
 */
export function msUntilNextMidnight(timeZone: string | null, instant: Date = new Date()): number {
  if (!timeZone) {
    const next = new Date(instant);
    next.setHours(24, 0, 0, 0);
    return next.getTime() - instant.getTime();
  }
  // An unusable zone makes shopWallClock fall back to the device's clock, consistently for the
  // day below and for every probe, so the bisection then simply finds the device's midnight.
  const today = toLocalDateString(shopWallClock(timeZone, instant));
  // Zone offsets are whole minutes, so from a minute-aligned base midnight is a whole number of
  // minutes away.
  const base = instant.getTime() - (instant.getUTCSeconds() * 1000 + instant.getUTCMilliseconds());
  const isNextDay = (minutes: number): boolean =>
    toLocalDateString(shopWallClock(timeZone, new Date(base + minutes * 60_000))) !== today;

  let low = 0;
  let high = MIDNIGHT_SEARCH_MINUTES;
  if (!isNextDay(high)) {
    // Cannot happen with a real zone; never return a non-positive delay that would spin a timer.
    return 86_400_000;
  }
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (isNextDay(mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return base + high * 60_000 - instant.getTime();
}
