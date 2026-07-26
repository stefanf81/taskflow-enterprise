import {
  formatTime12Hour,
  parseTimeToMinutes,
  formatMinutesToTimeString,
  computeEstimatedEndTime,
  isOverdue,
  DEFAULT_TIME_SLOTS,
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
});
