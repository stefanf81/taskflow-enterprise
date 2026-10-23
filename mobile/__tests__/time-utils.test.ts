import {
  formatTime12Hour,
  parseTimeToMinutes,
  formatMinutesToTimeString,
  computeEstimatedEndTime,
  isOverdue,
  toLocalDateString,
  getUpcomingDays,
  DEFAULT_TIME_SLOTS,
  MAX_BOOKING_DAYS_AHEAD,
  OUTSIDE_WINDOW_MESSAGE,
  PAST_SLOT_MESSAGE,
  getFirstSelectableSlot,
  getLastBookableDate,
  getSelectableSlots,
  getSlotValidationError,
  isSlotInPast,
  isWithinBookingWindow,
  resolveBookableSelection,
  shopWallClock,
} from '../src/utils/time-utils';

describe('time-utils', () => {
  // ==================== DEFAULT_TIME_SLOTS ====================
  it('exports default time slots', () => {
    expect(DEFAULT_TIME_SLOTS).toEqual([
      '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00',
    ]);
  });

  // ==================== formatTime12Hour ====================
  describe('formatTime12Hour', () => {
    it('converts morning time to AM', () => {
      expect(formatTime12Hour('09:00')).toBe('9:00 AM');
    });

    it('converts noon to PM', () => {
      expect(formatTime12Hour('12:00')).toBe('12:00 PM');
    });

    it('converts afternoon to PM', () => {
      expect(formatTime12Hour('14:30')).toBe('2:30 PM');
    });

    it('converts midnight as 12 AM', () => {
      expect(formatTime12Hour('00:00')).toBe('12:00 AM');
    });

    it('returns empty string for empty input', () => {
      expect(formatTime12Hour('')).toBe('');
    });

    it('returns original string for invalid format', () => {
      expect(formatTime12Hour('abc')).toBe('abc');
    });
  });

  // ==================== parseTimeToMinutes ====================
  describe('parseTimeToMinutes', () => {
    it('parses 09:00 to 540', () => {
      expect(parseTimeToMinutes('09:00')).toBe(540);
    });

    it('parses 14:30 to 870', () => {
      expect(parseTimeToMinutes('14:30')).toBe(870);
    });

    it('parses 00:00 to 0', () => {
      expect(parseTimeToMinutes('00:00')).toBe(0);
    });

    it('returns 0 for empty input', () => {
      expect(parseTimeToMinutes('')).toBe(0);
    });

    it('returns 0 for invalid input', () => {
      expect(parseTimeToMinutes('abc')).toBe(0);
    });
  });

  // ==================== formatMinutesToTimeString ====================
  describe('formatMinutesToTimeString', () => {
    it('formats 0 to 00:00', () => {
      expect(formatMinutesToTimeString(0)).toBe('00:00');
    });

    it('formats 540 to 09:00', () => {
      expect(formatMinutesToTimeString(540)).toBe('09:00');
    });

    it('formats 870 to 14:30', () => {
      expect(formatMinutesToTimeString(870)).toBe('14:30');
    });

    it('wraps around midnight', () => {
      expect(formatMinutesToTimeString(1440)).toBe('00:00');
    });

    it('handles single-digit hours and minutes', () => {
      expect(formatMinutesToTimeString(1)).toBe('00:01');
    });

    it('handles 23:59 correctly', () => {
      expect(formatMinutesToTimeString(1439)).toBe('23:59');
    });
  });

  // ==================== computeEstimatedEndTime ====================
  describe('computeEstimatedEndTime', () => {
    it('computes simple end time', () => {
      expect(computeEstimatedEndTime('09:00', 30)).toBe('09:30');
    });

    it('computes end time crossing hour boundary', () => {
      expect(computeEstimatedEndTime('09:45', 30)).toBe('10:15');
    });

    it('computes end time into next day', () => {
      expect(computeEstimatedEndTime('23:30', 60)).toBe('00:30');
    });

    it('returns empty for missing startTime', () => {
      expect(computeEstimatedEndTime('', 30)).toBe('');
    });

    it('returns empty for zero duration', () => {
      expect(computeEstimatedEndTime('09:00', 0)).toBe('');
    });
  });

  // ==================== isOverdue ====================
  describe('isOverdue', () => {
    it('returns true for past date', () => {
      expect(isOverdue('2020-01-01')).toBe(true);
    });

    it('returns false for future date', () => {
      expect(isOverdue('2099-12-31')).toBe(false);
    });

    it('returns false for today', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(isOverdue(todayStr)).toBe(false);
    });

    it('returns false for null input', () => {
      expect(isOverdue(null as unknown as string)).toBe(false);
    });

    it('returns false for undefined input', () => {
      expect(isOverdue(undefined as unknown as string)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isOverdue('')).toBe(false);
    });

    it('returns true for object with past bookingDate', () => {
      expect(isOverdue({ bookingDate: '2020-06-15' })).toBe(true);
    });

    it('returns false for object with future bookingDate', () => {
      expect(isOverdue({ bookingDate: '2099-06-15' })).toBe(false);
    });

    it('returns false for object with missing bookingDate', () => {
      expect(isOverdue({})).toBe(false);
    });
  });

  // ==================== toLocalDateString ====================
  describe('toLocalDateString', () => {
    it('formats a local date as YYYY-MM-DD', () => {
      expect(toLocalDateString(new Date(2026, 7, 15, 12, 0))).toBe('2026-08-15');
    });

    it('pads single-digit months and days', () => {
      expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('stays on the local calendar date near midnight', () => {
      // 23:30 local on Aug 15 must still render Aug 15 in ANY timezone
      // (toISOString() would drift to Aug 16 in timezones behind UTC).
      expect(toLocalDateString(new Date(2026, 7, 15, 23, 30))).toBe('2026-08-15');
    });
  });

  // ==================== getUpcomingDays ====================
  describe('getUpcomingDays', () => {
    it('returns 7 consecutive days starting from a Monday', () => {
      const days = getUpcomingDays(new Date(2026, 7, 10, 12, 0)); // Mon Aug 10 2026
      expect(days).toHaveLength(7);
      expect(days[0].dateStr).toBe('2026-08-10');
      expect(days[6].dateStr).toBe('2026-08-17');
    });

    it('skips Sundays', () => {
      const days = getUpcomingDays(new Date(2026, 7, 16, 12, 0)); // Sun Aug 16 2026
      expect(days).toHaveLength(7);
      expect(days[0].dateStr).toBe('2026-08-17'); // Monday after the Sunday
      expect(days.some((d) => d.dateStr === '2026-08-16')).toBe(false);
      expect(days.some((d) => d.dateStr === '2026-08-23')).toBe(false);
    });

    it('exposes day metadata for the day cards', () => {
      const days = getUpcomingDays(new Date(2026, 7, 10, 12, 0));
      expect(days[0]).toEqual({
        dateStr: '2026-08-10',
        dayName: 'Mon',
        dayNum: 10,
        monthName: 'Aug',
      });
    });
  });
});

describe('booking-window helpers (MOB-4)', () => {
  // Wednesday 2026-08-12, local time.
  const at = (hh: number, mm = 0, day = 12) => new Date(2026, 7, day, hh, mm, 0, 0);

  it('MAX_BOOKING_DAYS_AHEAD matches the server rule', () => {
    expect(MAX_BOOKING_DAYS_AHEAD).toBe(90);
  });

  describe('isSlotInPast', () => {
    it('treats earlier days as past and later days as future', () => {
      expect(isSlotInPast('2026-08-11', '16:00', at(8))).toBe(true);
      expect(isSlotInPast('2026-08-13', '09:00', at(23, 59))).toBe(false);
    });

    it('compares the time of day for today, and a slot starting exactly now is past', () => {
      expect(isSlotInPast('2026-08-12', '09:00', at(8, 59))).toBe(false);
      expect(isSlotInPast('2026-08-12', '09:00', at(9, 0))).toBe(true);
      expect(isSlotInPast('2026-08-12', '09:00', at(9, 1))).toBe(true);
    });

    it('is false for missing input', () => {
      expect(isSlotInPast('', '09:00', at(8))).toBe(false);
      expect(isSlotInPast('2026-08-12', '', at(8))).toBe(false);
    });
  });

  describe('booking window', () => {
    it('computes the last bookable local date', () => {
      expect(getLastBookableDate(at(10))).toBe('2026-11-10'); // 12 Aug + 90 days
    });

    it('accepts today through day 90 and rejects everything else', () => {
      expect(isWithinBookingWindow('2026-08-12', at(10))).toBe(true);
      expect(isWithinBookingWindow('2026-11-10', at(10))).toBe(true);
      expect(isWithinBookingWindow('2026-11-11', at(10))).toBe(false);
      expect(isWithinBookingWindow('2026-08-11', at(10))).toBe(false);
      expect(isWithinBookingWindow('', at(10))).toBe(false);
    });
  });

  describe('getSelectableSlots', () => {
    it('removes passed slots for today only', () => {
      expect(getSelectableSlots('2026-08-12', at(12, 30))).toEqual(['13:00', '14:00', '15:00', '16:00']);
      expect(getSelectableSlots('2026-08-13', at(12, 30))).toEqual([...DEFAULT_TIME_SLOTS]);
    });

    it('is empty outside the booking window or after the last slot', () => {
      expect(getSelectableSlots('2026-08-12', at(17))).toEqual([]);
      expect(getSelectableSlots('2026-11-11', at(10))).toEqual([]);
      expect(getSelectableSlots('2026-08-01', at(10))).toEqual([]);
    });
  });

  describe('getSlotValidationError', () => {
    it('returns null for a valid pair', () => {
      expect(getSlotValidationError('2026-08-12', '13:00', at(12))).toBeNull();
    });

    it('explains each failure', () => {
      expect(getSlotValidationError('', '13:00', at(12))).toMatch(/select a date and time/i);
      expect(getSlotValidationError('2026-08-12', '', at(12))).toMatch(/select a date and time/i);
      expect(getSlotValidationError('2026-08-12', '09:00', at(12))).toBe(PAST_SLOT_MESSAGE);
      expect(getSlotValidationError('2026-08-10', '09:00', at(12))).toBe(PAST_SLOT_MESSAGE);
      expect(getSlotValidationError('2026-12-01', '09:00', at(12))).toBe(OUTSIDE_WINDOW_MESSAGE);
    });
  });

  describe('selection resolution', () => {
    const dates = ['2026-08-12', '2026-08-13', '2026-08-14'];

    it('finds the first selectable slot, skipping days with none left', () => {
      expect(getFirstSelectableSlot(dates, at(8))).toEqual({ date: '2026-08-12', time: '09:00' });
      expect(getFirstSelectableSlot(dates, at(16, 30))).toEqual({ date: '2026-08-13', time: '09:00' });
      expect(getFirstSelectableSlot([], at(8))).toBeNull();
      expect(getFirstSelectableSlot(['2026-08-01'], at(8))).toBeNull();
    });

    it('keeps a still-valid selection', () => {
      const current = { date: '2026-08-13', time: '14:00' };
      expect(resolveBookableSelection(current, dates, at(10))).toBe(current);
    });

    it('moves to the next future slot on the same day when the time passed', () => {
      expect(
        resolveBookableSelection({ date: '2026-08-12', time: '09:00' }, dates, at(9, 30)),
      ).toEqual({ date: '2026-08-12', time: '10:00' });
    });

    it('moves to the next day when the whole day is over', () => {
      expect(
        resolveBookableSelection({ date: '2026-08-12', time: '16:00' }, dates, at(17)),
      ).toEqual({ date: '2026-08-13', time: '09:00' });
    });

    it('re-bases a stale date that rolled out of the offered days', () => {
      expect(
        resolveBookableSelection(
          { date: '2026-08-11', time: '10:00' },
          ['2026-08-12', '2026-08-13'],
          at(0, 5),
        ),
      ).toEqual({ date: '2026-08-12', time: '09:00' });
    });

    it('returns null when nothing is selectable', () => {
      expect(resolveBookableSelection({ date: '2026-08-12', time: '16:00' }, ['2026-08-12'], at(17))).toBeNull();
    });
  });

  describe('shopWallClock', () => {
    const instant = new Date('2026-10-12T23:30:00Z');

    it('reads the instant on the wall clock of the shop zone (as local components)', () => {
      const tokyo = shopWallClock('Asia/Tokyo', instant);
      expect([tokyo.getFullYear(), tokyo.getMonth(), tokyo.getDate()]).toEqual([2026, 9, 13]);
      expect([tokyo.getHours(), tokyo.getMinutes()]).toEqual([8, 30]);

      const newYork = shopWallClock('America/New_York', instant);
      expect([newYork.getDate(), newYork.getHours(), newYork.getMinutes()]).toEqual([12, 19, 30]);
    });

    it('renders midnight as 00:00, never 24:00', () => {
      const wall = shopWallClock('UTC', new Date('2026-10-13T00:05:00Z'));
      expect([wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([13, 0, 5]);
    });

    it('falls back to the phone clock without a usable zone', () => {
      expect(shopWallClock(null, instant)).toBe(instant);
      expect(shopWallClock('', instant)).toBe(instant);
      expect(shopWallClock('Not/AZone', instant)).toBe(instant);
    });

    it('makes the local-component helpers decide in the shop zone', () => {
      const tokyo = shopWallClock('Asia/Tokyo', instant); // 2026-10-13 08:30
      expect(isSlotInPast('2026-10-13', '09:00', tokyo)).toBe(false);
      expect(isSlotInPast('2026-10-13', '08:00', tokyo)).toBe(true);
      expect(isSlotInPast('2026-10-12', '16:00', tokyo)).toBe(true);
    });
  });
});
