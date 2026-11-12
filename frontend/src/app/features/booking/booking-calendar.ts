/**
 * Calendar rules of the booking wizard as pure functions: which days the date carousel offers,
 * which dates are closed, and which slots of a day can still be picked.
 *
 * Every function takes "now" as an argument (the shop's wall clock, see `ShopClock`) instead of
 * reading the clock, so `BookingStore` decides when time moves on and the rules are testable
 * without fake timers. The shop facts (opening days, booking window) are a `ShopRules` argument,
 * which `ShopClock.rules()` reads from the backend.
 */
import { type ShopRules, type WallClock, isOpenOn } from '@taskflow/domain';
import { isSlotInPast, toLocalDateString } from '../../core/time-utils';

/** How many bookable days the date carousel shows. */
export const CAROUSEL_DAY_COUNT = 7;

/** How many calendar days (from today) the carousel searches for its bookable days. */
const CAROUSEL_LOOKAHEAD_DAYS = 14;
const SHORT_WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const SHORT_MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short' });

/** One chip of the date carousel. */
export interface BookingDay {
  /** `YYYY-MM-DD` in the shop's calendar. */
  dateStr: string;
  dayName: string;
  dayNum: number;
  monthName: string;
}

/** Whether the shop is closed on `dateStr` (`YYYY-MM-DD`): no barber works that weekday. */
export function isClosedDay(dateStr: string, rules: ShopRules): boolean {
  return !!dateStr && !isOpenOn(dateStr, rules);
}

/** Whether every slot of `dateStr` has already started at `now`. */
export function isDayOver(dateStr: string, now: WallClock, slots: readonly string[]): boolean {
  return slots.every((slot) => isSlotInPast(dateStr, slot, now));
}

/**
 * The next {@link CAROUSEL_DAY_COUNT} days a booking can be made on, starting today: closed
 * weekdays are skipped, and so is today once none of its slots is left.
 */
export function upcomingBookingDays(
  now: WallClock,
  slots: readonly string[],
  rules: ShopRules,
): BookingDay[] {
  const days: BookingDay[] = [];
  // Offsets 0..maxAdvanceDays are inside the booking window.
  const lookahead = Math.min(CAROUSEL_LOOKAHEAD_DAYS, rules.maxAdvanceDays + 1);
  for (let offset = 0; days.length < CAROUSEL_DAY_COUNT && offset < lookahead; offset++) {
    // Noon avoids midnight DST rollovers on the visitor's device while keeping weekday/month names exact.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
    const dateStr = toLocalDateString(date);
    if (!isOpenOn(dateStr, rules)) continue;
    if (offset === 0 && isDayOver(dateStr, now, slots)) continue;
    days.push({
      dateStr,
      dayName: SHORT_WEEKDAY_FORMAT.format(date),
      dayNum: date.getDate(),
      monthName: SHORT_MONTH_FORMAT.format(date),
    });
  }
  return days;
}

/** A slot of `dateStr` that cannot be chosen: taken, or (today) already started. */
export function isSlotUnavailable(
  dateStr: string,
  slot: string,
  now: WallClock,
  busySlots: readonly string[],
): boolean {
  return busySlots.includes(slot) || isSlotInPast(dateStr, slot, now);
}

/** The first slot of `dateStr` that has not started and is not known to be taken ('' if none). */
export function firstOpenSlot(
  dateStr: string,
  now: WallClock,
  slots: readonly string[],
  busySlots: readonly string[],
): string {
  return slots.find((slot) => !isSlotUnavailable(dateStr, slot, now, busySlots)) ?? '';
}
