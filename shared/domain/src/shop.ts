import {
  type WallClock,
  addDays,
  formatTime12Hour,
  isValidLocalDate,
  parseLocalDate,
  parseTimeToMinutes,
  toLocalDateString,
} from './time';

/** One weekday's hours as `GET /api/v1/appointments/public/shop` reports them. */
export interface OpeningHours {
  /** ISO weekday: 1 (Monday) to 7 (Sunday). */
  dayOfWeek: number;
  /** `HH:mm`, shop time zone. */
  opens: string;
  /** `HH:mm`, shop time zone. */
  closes: string;
}

/**
 * The shop's booking rules from `GET /api/v1/appointments/public/shop`: how far ahead a booking may
 * be made, and the weekdays the shop is open (a weekday without hours is closed).
 */
export interface ShopRules {
  maxAdvanceDays: number;
  openingHours: readonly OpeningHours[];
}

/**
 * The server's built-in defaults (`app.booking.*`: 90 days ahead; the seeded barbers work
 * Monday-Saturday 09:00-17:00). Clients use them until `/public/shop` has answered or when it
 * cannot be loaded; the server stays authoritative either way.
 */
export const DEFAULT_SHOP_RULES: ShopRules = {
  maxAdvanceDays: 90,
  openingHours: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opens: '09:00', closes: '17:00' })),
};

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** English name of an ISO weekday. */
function dayName(dayOfWeek: number): string {
  return WEEKDAY_NAMES[dayOfWeek - 1] ?? '';
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a wall-clock date. */
export function isoWeekday(date: WallClock): number {
  return ((date.getDay() + 6) % 7) + 1;
}

/** The hours of an ISO weekday, or undefined when the shop is closed that day. */
export function hoursOn(rules: ShopRules, dayOfWeek: number): OpeningHours | undefined {
  return rules.openingHours.find((hours) => hours.dayOfWeek === dayOfWeek);
}

/** Whether the shop is open on a `YYYY-MM-DD` date (false for anything unparseable). */
export function isOpenOn(dateStr: string, rules: ShopRules): boolean {
  const date = parseLocalDate(dateStr);
  return !Number.isNaN(date.getTime()) && hoursOn(rules, isoWeekday(date)) !== undefined;
}

/** `Date#getDay()` numbers (0 = Sunday) of the weekdays the shop is closed. */
export function closedWeekdays(rules: ShopRules): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((jsDay) => hoursOn(rules, ((jsDay + 6) % 7) + 1) === undefined);
}

/** The last bookable date: today plus `maxAdvanceDays`. */
export function lastBookableDate(now: WallClock, rules: ShopRules): string {
  return addDays(now, rules.maxAdvanceDays);
}

/** Whether `dateStr` lies in [today, today + maxAdvanceDays], the window the server accepts. */
export function isWithinBookingWindow(dateStr: string, now: WallClock, rules: ShopRules): boolean {
  return isValidLocalDate(dateStr) && dateStr >= toLocalDateString(now) && dateStr <= lastBookableDate(now, rules);
}

/** "Bookings can be made at most 90 days ahead." */
export function bookingWindowMessage(rules: ShopRules): string {
  return `Bookings can be made at most ${rules.maxAdvanceDays} days ahead.`;
}

/** "We are closed on Sunday." / "We are closed on Saturday and Sunday." (null when open daily). */
export function closedDaysMessage(rules: ShopRules): string | null {
  const closed = WEEKDAY_NAMES.filter((_, index) => hoursOn(rules, index + 1) === undefined);
  if (closed.length === 0) return null;
  const last = closed.pop() ?? '';
  const list = closed.length === 0 ? last : `${closed.join(', ')} and ${last}`;
  return `We are closed on ${list}.`;
}

/** A row of the opening-hours table: consecutive weekdays with the same hours, or closed. */
export interface OpeningHoursRow {
  /** "Monday - Saturday", or a single day name. */
  days: string;
  /** "9:00 AM - 5:00 PM", or null when closed. */
  hours: string | null;
}

/** The week, Monday first, folded into rows of consecutive days that share their hours. */
export function openingHoursRows(rules: ShopRules): OpeningHoursRow[] {
  const label = (dayOfWeek: number): string | null => {
    const hours = hoursOn(rules, dayOfWeek);
    return hours ? `${formatTime12Hour(hours.opens)} - ${formatTime12Hour(hours.closes)}` : null;
  };
  const rows: OpeningHoursRow[] = [];
  let start = 1;
  for (let day = 2; day <= 8; day++) {
    if (day <= 7 && label(day) === label(start)) continue;
    const days = start === day - 1 ? dayName(start) : `${dayName(start)} - ${dayName(day - 1)}`;
    rows.push({ days, hours: label(start) });
    start = day;
  }
  return rows;
}

/** Whether the shop is open at the wall-clock moment `now` (shop time zone, see shopWallClock). */
export function isOpenAt(now: WallClock, rules: ShopRules): boolean {
  const hours = hoursOn(rules, isoWeekday(now));
  if (!hours) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= parseTimeToMinutes(hours.opens) && minutes < parseTimeToMinutes(hours.closes);
}
