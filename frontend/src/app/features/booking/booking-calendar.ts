/**
 * Calendar rules of the booking wizard as pure functions: which days the date carousel offers,
 * which dates are closed, and which slots of a day can still be picked.
 *
 * Every function takes "now" as an argument (the shop's wall clock, see `ShopClock`) instead of
 * reading the clock, so `BookingStore` decides when time moves on and the rules are testable
 * without fake timers. The shop facts (closed weekdays, the 90-day window in
 * `MAX_BOOKING_DAYS_AHEAD`) are constants today; they are parameters with defaults so they can
 * later come from the backend.
 */
import { MAX_BOOKING_DAYS_AHEAD, isSlotInPast, toLocalDateString } from '../../core/time-utils';

/** Weekdays the shop is closed, numbered like `Date.getDay()` (0 = Sunday). */
export const SHOP_CLOSED_WEEKDAYS: readonly number[] = [0];

/** How many bookable days the date carousel shows. */
export const CAROUSEL_DAY_COUNT = 7;

/** How many calendar days (from today) the carousel searches for its bookable days. */
const CAROUSEL_LOOKAHEAD_DAYS = 14;

/** One chip of the date carousel. */
export interface BookingDay {
  /** `YYYY-MM-DD` in the shop's calendar. */
  dateStr: string;
  dayName: string;
  dayNum: number;
  monthName: string;
}

/** Whether the shop is closed on `dateStr` (`YYYY-MM-DD`). */
export function isClosedDay(
  dateStr: string,
  closedWeekdays: readonly number[] = SHOP_CLOSED_WEEKDAYS,
): boolean {
  if (!dateStr) return false;
  // A date-only string parses as UTC midnight, so its UTC weekday is the calendar date's own in
  // every visitor time zone.
  return closedWeekdays.includes(new Date(dateStr).getUTCDay());
}

/** Whether every slot of `dateStr` has already started at `now`. */
export function isDayOver(dateStr: string, now: Date, slots: readonly string[]): boolean {
  return slots.every((slot) => isSlotInPast(dateStr, slot, now));
}

/**
 * The next {@link CAROUSEL_DAY_COUNT} days a booking can be made on, starting today: closed
 * weekdays are skipped, and so is today once none of its slots is left.
 */
export function upcomingBookingDays(
  now: Date,
  slots: readonly string[],
  closedWeekdays: readonly number[] = SHOP_CLOSED_WEEKDAYS,
): BookingDay[] {
  const days: BookingDay[] = [];
  const lookahead = Math.min(CAROUSEL_LOOKAHEAD_DAYS, MAX_BOOKING_DAYS_AHEAD);
  for (let offset = 0; days.length < CAROUSEL_DAY_COUNT && offset < lookahead; offset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    // Local components on purpose: `now` is the shop's wall clock, and `toISOString()` would
    // shift the day in US/EU time zones.
    const dateStr = toLocalDateString(date);
    if (closedWeekdays.includes(date.getDay())) continue;
    if (offset === 0 && isDayOver(dateStr, now, slots)) continue;
    days.push({
      dateStr,
      dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNum: date.getDate(),
      monthName: date.toLocaleDateString('en-US', { month: 'short' }),
    });
  }
  return days;
}

/** A slot of `dateStr` that cannot be chosen: taken, or (today) already started. */
export function isSlotUnavailable(
  dateStr: string,
  slot: string,
  now: Date,
  busySlots: readonly string[],
): boolean {
  return busySlots.includes(slot) || isSlotInPast(dateStr, slot, now);
}

/** The first slot of `dateStr` that has not started and is not known to be taken ('' if none). */
export function firstOpenSlot(
  dateStr: string,
  now: Date,
  slots: readonly string[],
  busySlots: readonly string[],
): string {
  return slots.find((slot) => !isSlotUnavailable(dateStr, slot, now, busySlots)) ?? '';
}
