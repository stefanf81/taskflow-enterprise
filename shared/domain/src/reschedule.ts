import { hoursOn, isOpenOn, isWithinBookingWindow, isoWeekday, type ShopRules } from './shop';
import { addDays, isSlotInPast, parseLocalDate, parseTimeToMinutes } from './time';

/** How many bookable days a reschedule picker offers. */
export const RESCHEDULE_DAY_COUNT = 14;

/**
 * The slots of `dateStr` a booking can move to as far as the shop's rules go: on a grid slot,
 * within that weekday's opening hours, not started yet, and not in `busy` (the barber's busy
 * slots, when known). The server re-checks the barber's own schedule, time off and the
 * service's length when the move is saved.
 */
export function openSlotsOn(
  dateStr: string,
  now: Date,
  rules: ShopRules,
  slots: readonly string[],
  busy: readonly string[] = [],
): string[] {
  if (!isOpenOn(dateStr, rules) || !isWithinBookingWindow(dateStr, now, rules)) return [];
  const hours = hoursOn(rules, isoWeekday(parseLocalDate(dateStr)));
  if (!hours) return [];
  const opens = parseTimeToMinutes(hours.opens);
  const closes = parseTimeToMinutes(hours.closes);
  return slots.filter((slot) => {
    const minute = parseTimeToMinutes(slot);
    return (
      minute >= opens && minute < closes && !busy.includes(slot) && !isSlotInPast(dateStr, slot, now)
    );
  });
}

/**
 * The next `count` dates (`YYYY-MM-DD`) a booking can move to, from today: open weekdays inside
 * the booking window that still have a slot left.
 */
export function rescheduleDates(
  now: Date,
  rules: ShopRules,
  slots: readonly string[],
  count: number = RESCHEDULE_DAY_COUNT,
): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset <= rules.maxAdvanceDays && dates.length < count; offset++) {
    const dateStr = addDays(now, offset);
    if (openSlotsOn(dateStr, now, rules, slots).length > 0) dates.push(dateStr);
  }
  return dates;
}
