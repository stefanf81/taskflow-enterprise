import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOP_RULES,
  bookingWindowMessage,
  closedDaysMessage,
  closedWeekdays,
  isOpenAt,
  isOpenOn,
  isWithinBookingWindow,
  isoWeekday,
  lastBookableDate,
  openingHoursRows,
  type ShopRules,
} from './shop';

const weekdaysOnly: ShopRules = {
  maxAdvanceDays: 30,
  openingHours: [
    { dayOfWeek: 1, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 3, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 4, opens: '10:00', closes: '18:00' },
    { dayOfWeek: 5, opens: '09:00', closes: '17:00' },
  ],
};

describe('shop rules', () => {
  it('numbers weekdays the ISO way', () => {
    expect(isoWeekday(new Date(2026, 7, 3))).toBe(1); // a Monday
    expect(isoWeekday(new Date(2026, 7, 9))).toBe(7); // a Sunday
  });

  it('knows which dates the shop is open', () => {
    expect(isOpenOn('2026-08-08', DEFAULT_SHOP_RULES)).toBe(true); // Saturday
    expect(isOpenOn('2026-08-09', DEFAULT_SHOP_RULES)).toBe(false); // Sunday
    expect(isOpenOn('2026-08-08', weekdaysOnly)).toBe(false);
    expect(isOpenOn('not-a-date', DEFAULT_SHOP_RULES)).toBe(false);
    expect(isOpenOn('2026-02-31', DEFAULT_SHOP_RULES)).toBe(false);
    expect(closedWeekdays(DEFAULT_SHOP_RULES)).toEqual([0]);
    expect(closedWeekdays(weekdaysOnly)).toEqual([0, 6]);
  });

  it('accepts dates from today to today + maxAdvanceDays', () => {
    const now = new Date(2026, 7, 3, 12, 0);
    expect(lastBookableDate(now, weekdaysOnly)).toBe('2026-09-02');
    expect(isWithinBookingWindow('2026-08-03', now, weekdaysOnly)).toBe(true);
    expect(isWithinBookingWindow('2026-09-02', now, weekdaysOnly)).toBe(true);
    expect(isWithinBookingWindow('2026-09-03', now, weekdaysOnly)).toBe(false);
    expect(isWithinBookingWindow('2026-08-02', now, weekdaysOnly)).toBe(false);
    expect(isWithinBookingWindow('2026-08-32', now, weekdaysOnly)).toBe(false);
    expect(isWithinBookingWindow('', now, weekdaysOnly)).toBe(false);
    expect(bookingWindowMessage(weekdaysOnly)).toBe('Bookings can be made at most 30 days ahead.');
  });

  it('names the closed days', () => {
    expect(closedDaysMessage(DEFAULT_SHOP_RULES)).toBe('We are closed on Sunday.');
    expect(closedDaysMessage(weekdaysOnly)).toBe('We are closed on Saturday and Sunday.');
    expect(closedDaysMessage({ maxAdvanceDays: 1, openingHours: [] })).toBe(
      'We are closed on Monday, Tuesday, Wednesday, Thursday, Friday, Saturday and Sunday.',
    );
  });

  it('folds the week into rows of days that share their hours', () => {
    expect(openingHoursRows(DEFAULT_SHOP_RULES)).toEqual([
      { days: 'Monday - Saturday', hours: '9:00 AM - 5:00 PM' },
      { days: 'Sunday', hours: null },
    ]);
    expect(openingHoursRows(weekdaysOnly)).toEqual([
      { days: 'Monday - Wednesday', hours: '9:00 AM - 5:00 PM' },
      { days: 'Thursday', hours: '10:00 AM - 6:00 PM' },
      { days: 'Friday', hours: '9:00 AM - 5:00 PM' },
      { days: 'Saturday - Sunday', hours: null },
    ]);
  });

  it('is open between opening and closing time only', () => {
    expect(isOpenAt(new Date(2026, 7, 3, 8, 59), DEFAULT_SHOP_RULES)).toBe(false);
    expect(isOpenAt(new Date(2026, 7, 3, 9, 0), DEFAULT_SHOP_RULES)).toBe(true);
    expect(isOpenAt(new Date(2026, 7, 3, 17, 0), DEFAULT_SHOP_RULES)).toBe(false);
    expect(isOpenAt(new Date(2026, 7, 9, 12, 0), DEFAULT_SHOP_RULES)).toBe(false); // Sunday
  });
});
