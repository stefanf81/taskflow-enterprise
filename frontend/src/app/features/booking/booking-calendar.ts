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
 * Every day a booking can be made on, today first: the shop's open weekdays inside the booking
 * window, minus today once none of its slots is left. The date carousel pages through this list.
 */
export function bookableDays(
  now: WallClock,
  slots: readonly string[],
  rules: ShopRules,
): BookingDay[] {
  const days: BookingDay[] = [];
  // Offsets 0..maxAdvanceDays are inside the booking window.
  for (let offset = 0; offset <= rules.maxAdvanceDays; offset++) {
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

/** How many carousel pages `totalDays` bookable days make (at least one). */
export function dayPageCount(totalDays: number): number {
  return Math.max(1, Math.ceil(totalDays / CAROUSEL_DAY_COUNT));
}

/** The {@link CAROUSEL_DAY_COUNT} days of carousel page `page` (0 = the first days from today). */
export function daysOfPage(days: readonly BookingDay[], page: number): BookingDay[] {
  return days.slice(page * CAROUSEL_DAY_COUNT, (page + 1) * CAROUSEL_DAY_COUNT);
}

/** The carousel page that shows `dateStr` (0 when it is not a bookable day). */
export function pageOfDay(days: readonly BookingDay[], dateStr: string): number {
  const index = days.findIndex((day) => day.dateStr === dateStr);
  return index < 0 ? 0 : Math.floor(index / CAROUSEL_DAY_COUNT);
}

/**
 * The first page of {@link bookableDays}: the next {@link CAROUSEL_DAY_COUNT} days a booking can
 * be made on, starting today (`page` pages further for later ones).
 */
export function upcomingBookingDays(
  now: WallClock,
  slots: readonly string[],
  rules: ShopRules,
  page = 0,
): BookingDay[] {
  return daysOfPage(bookableDays(now, slots, rules), page);
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

/** The slots of one part of the day. */
export interface SlotGroup {
  part: PartOfDay;
  label: string;
  slots: string[];
}

/**
 * Groups `HH:mm` slots into Morning (before 12:00), Afternoon (12:00-16:59) and Evening (17:00
 * on), in time order. A part without a slot is left out, so a shop that closes at 17:00 shows
 * two groups.
 */
export function groupSlotsByPartOfDay(slots: readonly string[]): SlotGroup[] {
  const groups: SlotGroup[] = [
    { part: 'morning', label: 'Morning', slots: [] },
    { part: 'afternoon', label: 'Afternoon', slots: [] },
    { part: 'evening', label: 'Evening', slots: [] },
  ];
  for (const slot of slots) {
    const hour = Number(slot.slice(0, 2));
    const group = groups[hour < 12 ? 0 : hour < 17 ? 1 : 2];
    group?.slots.push(slot);
  }
  return groups.filter((group) => group.slots.length > 0);
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
