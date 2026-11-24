import { describe, it, expect } from 'vitest';
import { DEFAULT_SHOP_RULES, type ShopRules } from '@taskflow/domain';
import { DEFAULT_TIME_SLOTS } from '../../core/time-utils';
import {
  CAROUSEL_DAY_COUNT,
  bookableDays,
  dayPageCount,
  daysOfPage,
  firstOpenSlot,
  groupSlotsByPartOfDay,
  pageOfDay,
  isClosedDay,
  isDayOver,
  isSlotUnavailable,
  upcomingBookingDays,
} from './booking-calendar';

/** Monday 12 October 2026, 14:30 on the shop's wall clock. */
const MONDAY_AFTERNOON = new Date(2026, 9, 12, 14, 30);

/** The server's defaults: open Monday-Saturday, 90 days ahead. */
const RULES = DEFAULT_SHOP_RULES;
const openOn = (...days: number[]): ShopRules => ({
  maxAdvanceDays: 90,
  openingHours: days.map((dayOfWeek) => ({ dayOfWeek, opens: '09:00', closes: '17:00' })),
});

describe('booking calendar rules', () => {
  describe('isClosedDay', () => {
    it('closes the weekdays without opening hours (Sunday by default), by the date itself', () => {
      expect(isClosedDay('2026-10-11', RULES)).toBe(true); // Sunday
      expect(isClosedDay('2026-10-12', RULES)).toBe(false);
      expect(isClosedDay('2026-10-17', RULES)).toBe(false); // Saturday
      expect(isClosedDay('', RULES)).toBe(false);
    });

    it("follows the shop's opening hours", () => {
      expect(isClosedDay('2026-10-12', openOn(2, 3, 4, 5, 6))).toBe(true); // Monday closed
      expect(isClosedDay('2026-10-11', openOn(1, 2, 3, 4, 5, 6, 7))).toBe(false); // open daily
    });
  });

  describe('upcomingBookingDays', () => {
    it('offers seven days from today and skips Sundays', () => {
      const days = upcomingBookingDays(MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, RULES);

      expect(days).toHaveLength(CAROUSEL_DAY_COUNT);
      expect(days.map((d) => d.dateStr)).toEqual([
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
        '2026-10-19',
      ]);
      expect(days[0]).toEqual({
        dateStr: '2026-10-12',
        dayName: 'Mon',
        dayNum: 12,
        monthName: 'Oct',
      });
    });

    it('drops today once its last slot has started', () => {
      const evening = new Date(2026, 9, 12, 16, 0);
      expect(upcomingBookingDays(evening, DEFAULT_TIME_SLOTS, RULES)[0]?.dateStr).toBe(
        '2026-10-13',
      );
    });

    it('crosses month boundaries in the local calendar', () => {
      const lastOfMonth = new Date(2026, 9, 31, 8, 0); // a Saturday
      const days = upcomingBookingDays(lastOfMonth, DEFAULT_TIME_SLOTS, RULES);
      expect(days.slice(0, 2).map((d) => [d.dateStr, d.monthName])).toEqual([
        ['2026-10-31', 'Oct'],
        ['2026-11-02', 'Nov'],
      ]);
    });

    it("skips the days the shop's opening hours leave out", () => {
      const days = upcomingBookingDays(MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, openOn(1, 2, 3, 4, 5));
      expect(days.some((d) => d.dayName === 'Sat' || d.dayName === 'Sun')).toBe(false);
    });

    it('never offers a day past the booking window', () => {
      const days = upcomingBookingDays(MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, {
        ...RULES,
        maxAdvanceDays: 2,
      });
      expect(days.map((d) => d.dateStr)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    });
  });

  describe('paging through the booking window', () => {
    it('lists every bookable day of the window, then pages seven at a time', () => {
      const all = bookableDays(MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, RULES);
      // Today..today+90 (91 days), minus the 13 Sundays among them.
      expect(all).toHaveLength(78);
      expect(all[0]?.dateStr).toBe('2026-10-12');
      expect(all.at(-1)?.dateStr).toBe('2027-01-09'); // the last Saturday inside the window
      expect(dayPageCount(all.length)).toBe(12);

      expect(daysOfPage(all, 1).map((d) => d.dateStr)).toEqual([
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
        '2026-10-24',
        '2026-10-26',
        '2026-10-27',
      ]);
      expect(daysOfPage(all, 11)).toHaveLength(78 - 11 * CAROUSEL_DAY_COUNT);
      expect(upcomingBookingDays(MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, RULES, 1)).toEqual(
        daysOfPage(all, 1),
      );
    });

    it('always has one page, and finds the page of a day', () => {
      expect(dayPageCount(0)).toBe(1);
      expect(dayPageCount(7)).toBe(1);
      expect(dayPageCount(8)).toBe(2);

      const all = bookableDays(MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, RULES);
      expect(pageOfDay(all, '2026-10-12')).toBe(0);
      expect(pageOfDay(all, '2026-10-19')).toBe(0);
      expect(pageOfDay(all, '2026-10-20')).toBe(1);
      expect(pageOfDay(all, '2026-10-18')).toBe(0); // a Sunday: not bookable
      expect(pageOfDay(all, '')).toBe(0);
    });
  });

  describe('groupSlotsByPartOfDay', () => {
    it('splits the default grid into morning and afternoon, leaving out the empty evening', () => {
      expect(groupSlotsByPartOfDay(DEFAULT_TIME_SLOTS)).toEqual([
        { part: 'morning', label: 'Morning', slots: ['09:00', '10:00', '11:00'] },
        { part: 'afternoon', label: 'Afternoon', slots: ['13:00', '14:00', '15:00', '16:00'] },
      ]);
    });

    it('puts 12:00 in the afternoon and 17:00 in the evening, and drops empty parts', () => {
      expect(groupSlotsByPartOfDay(['11:30', '12:00', '16:59', '17:00', '19:30'])).toEqual([
        { part: 'morning', label: 'Morning', slots: ['11:30'] },
        { part: 'afternoon', label: 'Afternoon', slots: ['12:00', '16:59'] },
        { part: 'evening', label: 'Evening', slots: ['17:00', '19:30'] },
      ]);
      expect(groupSlotsByPartOfDay(['16:00'])).toEqual([
        { part: 'afternoon', label: 'Afternoon', slots: ['16:00'] },
      ]);
      expect(groupSlotsByPartOfDay([])).toEqual([]);
    });
  });

  describe('slots', () => {
    it('knows when a day is over', () => {
      expect(isDayOver('2026-10-12', MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS)).toBe(false);
      expect(isDayOver('2026-10-12', new Date(2026, 9, 12, 16, 0), DEFAULT_TIME_SLOTS)).toBe(true);
      expect(isDayOver('2026-10-13', new Date(2026, 9, 12, 23, 0), DEFAULT_TIME_SLOTS)).toBe(false);
    });

    it('treats a taken or already started slot as unavailable', () => {
      expect(isSlotUnavailable('2026-10-12', '14:00', MONDAY_AFTERNOON, [])).toBe(true);
      expect(isSlotUnavailable('2026-10-12', '15:00', MONDAY_AFTERNOON, [])).toBe(false);
      expect(isSlotUnavailable('2026-10-12', '15:00', MONDAY_AFTERNOON, ['15:00'])).toBe(true);
      expect(isSlotUnavailable('2026-10-13', '09:00', MONDAY_AFTERNOON, [])).toBe(false);
    });

    it('finds the first slot that is neither past nor taken', () => {
      expect(firstOpenSlot('2026-10-12', MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, [])).toBe('15:00');
      expect(firstOpenSlot('2026-10-12', MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, ['15:00'])).toBe(
        '16:00',
      );
      expect(firstOpenSlot('2026-10-13', MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, ['09:00'])).toBe(
        '10:00',
      );
      expect(
        firstOpenSlot('2026-10-12', MONDAY_AFTERNOON, DEFAULT_TIME_SLOTS, ['15:00', '16:00']),
      ).toBe('');
    });
  });
});
