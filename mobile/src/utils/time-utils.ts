/**
 * Time and booking-window helpers of the mobile client. The ones both clients share come from
 * `@taskflow/domain` (re-exported here so the app keeps one import point); the slot-selection
 * helpers below are the mobile wizard's own.
 *
 * Every helper takes `now` (the shop's wall clock, see shopWallClock) and the shop's rules
 * (`GET /api/v1/appointments/public/shop`, see useShopInfo) instead of reading them, so they are
 * deterministic in tests. The rules default to the server's built-in ones.
 */
import {
  DEFAULT_SHOP_RULES,
  DEFAULT_TIME_SLOTS,
  type ShopRules,
  type WallClock,
  bookingWindowMessage,
  isOpenOn,
  isSlotInPast,
  isWithinBookingWindow,
  toLocalDateString,
} from '@taskflow/domain';

export {
  DEFAULT_TIME_SLOTS,
  type WallClock,
  computeEstimatedEndTime,
  formatMinutesToTimeString,
  formatTime12Hour,
  formatUsd,
  isOverdue,
  isSlotInPast,
  parseLocalDate,
  parseTimeToMinutes,
  shopWallClock,
  toLocalDateString,
} from '@taskflow/domain';

export interface UpcomingDay {
  dateStr: string;
  dayName: string;
  dayNum: number;
  monthName: string;
}

/** How many calendar days (from `from`) the day list searches for open days. */
const LOOKAHEAD_DAYS = 14;
const SHORT_WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const SHORT_MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short' });

/**
 * The next `count` open days starting at `from`: days the shop's opening hours leave out are
 * skipped, and so is anything past the booking window. Built from local getters, so `dateStr`
 * matches the calendar the user sees (no UTC drift).
 */
export function getUpcomingDays(
  from: WallClock,
  count = 7,
  rules: ShopRules = DEFAULT_SHOP_RULES,
): UpcomingDay[] {
  const days: UpcomingDay[] = [];
  const lookahead = Math.min(LOOKAHEAD_DAYS, rules.maxAdvanceDays + 1);
  for (let offset = 0; days.length < count && offset < lookahead; offset++) {
    const nextDate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, 12);
    const dateStr = toLocalDateString(nextDate);
    if (!isOpenOn(dateStr, rules)) continue;
    days.push({
      dateStr,
      dayName: SHORT_WEEKDAY_FORMAT.format(nextDate),
      dayNum: nextDate.getDate(),
      monthName: SHORT_MONTH_FORMAT.format(nextDate),
    });
  }
  return days;
}

export const PAST_SLOT_MESSAGE = 'That time has already passed. Please choose a later slot.';

/** The subset of `slots` that are still in the future on `dateStr` (empty outside the window). */
export function getSelectableSlots(
  dateStr: string,
  now: WallClock,
  slots: readonly string[] = DEFAULT_TIME_SLOTS,
  rules: ShopRules = DEFAULT_SHOP_RULES,
): string[] {
  if (!isWithinBookingWindow(dateStr, now, rules)) return [];
  return slots.filter((slot) => !isSlotInPast(dateStr, slot, now));
}

/** Why a date/time pair cannot be booked, or null when it can. */
export function getSlotValidationError(
  dateStr: string,
  time24: string,
  now: WallClock,
  rules: ShopRules = DEFAULT_SHOP_RULES,
): string | null {
  if (!dateStr || !time24) return 'Please select a date and time slot.';
  if (!isWithinBookingWindow(dateStr, now, rules)) {
    return dateStr < toLocalDateString(now) ? PAST_SLOT_MESSAGE : bookingWindowMessage(rules);
  }
  if (isSlotInPast(dateStr, time24, now)) return PAST_SLOT_MESSAGE;
  return null;
}

export interface SlotSelection {
  date: string;
  time: string;
}

/** First day (in `dates` order) that still has a selectable slot, with its first slot. */
export function getFirstSelectableSlot(
  dates: readonly string[],
  now: WallClock,
  slots: readonly string[] = DEFAULT_TIME_SLOTS,
  rules: ShopRules = DEFAULT_SHOP_RULES,
): SlotSelection | null {
  for (const date of dates) {
    const time = getSelectableSlots(date, now, slots, rules)[0];
    if (time !== undefined) return { date, time };
  }
  return null;
}

/**
 * Keep `current` when it is still bookable; otherwise prefer the first future
 * slot on the same day, then the first selectable slot of the offered days.
 * Returns null when nothing is selectable (callers keep their state).
 */
export function resolveBookableSelection(
  current: SlotSelection,
  dates: readonly string[],
  now: WallClock,
  slots: readonly string[] = DEFAULT_TIME_SLOTS,
  rules: ShopRules = DEFAULT_SHOP_RULES,
): SlotSelection | null {
  if (
    dates.includes(current.date) &&
    getSlotValidationError(current.date, current.time, now, rules) === null
  ) {
    return current;
  }
  if (dates.includes(current.date)) {
    const sameDay = getSelectableSlots(current.date, now, slots, rules)[0];
    if (sameDay !== undefined) return { date: current.date, time: sameDay };
  }
  return getFirstSelectableSlot(dates, now, slots, rules);
}
