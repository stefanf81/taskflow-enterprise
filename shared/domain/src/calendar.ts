import { isoWeekday } from './shop';
import { addDays, parseLocalDate } from './time';

/**
 * The owner's calendar: one day, or one Monday-to-Sunday week. Dates are `YYYY-MM-DD` strings in
 * the shop's calendar, as the API sends them; nothing here reads a clock.
 */
export type CalendarView = 'day' | 'week';

/** Inclusive `YYYY-MM-DD` bounds, as `GET /api/v1/appointments?from=&to=` takes them. */
export interface CalendarRange {
  from: string;
  to: string;
}

/** Statuses that hold a slot. A denied or cancelled booking has released it, so it is not drawn. */
export const SLOT_HOLDING_STATUSES: readonly string[] = ['PENDING', 'APPROVED'];

/** `date` moved by `days` calendar days. */
export function shiftDate(date: string, days: number): string {
  return addDays(parseLocalDate(date), days);
}

/** The Monday of the ISO week `date` falls in. */
export function weekStart(date: string): string {
  return shiftDate(date, 1 - isoWeekday(parseLocalDate(date)));
}

/** The days a view covers around `anchor`: that day, or the Monday-to-Sunday week it is in. */
export function rangeOf(view: CalendarView, anchor: string): CalendarRange {
  if (view === 'day') return { from: anchor, to: anchor };
  const monday = weekStart(anchor);
  return { from: monday, to: shiftDate(monday, 6) };
}

/** Every date of a range, in order (at most a year, so a bad range cannot loop for long). */
export function datesOf(range: CalendarRange): string[] {
  const dates: string[] = [];
  for (let date = range.from; date <= range.to && dates.length < 366; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** How far the previous/next buttons move the anchor. */
export function stepOf(view: CalendarView): number {
  return view === 'day' ? 1 : 7;
}
