import {
  formatTime12Hour,
  parseTimeToMinutes,
  formatMinutesToTimeString,
  computeEstimatedEndTime,
  isOverdue,
} from '../src/utils/time-utils';

describe('time-utils', () => {
  describe('formatTime12Hour', () => {
    it('converts "09:00" to "9:00 AM"', () => {
      expect(formatTime12Hour('09:00')).toBe('9:00 AM');
    });

    it('converts "12:00" to "12:00 PM"', () => {
      expect(formatTime12Hour('12:00')).toBe('12:00 PM');
    });

    it('converts "13:30" to "1:30 PM"', () => {
      expect(formatTime12Hour('13:30')).toBe('1:30 PM');
    });

    it('converts "00:00" to "12:00 AM"', () => {
      expect(formatTime12Hour('00:00')).toBe('12:00 AM');
    });

    it('returns empty string for empty input', () => {
      expect(formatTime12Hour('')).toBe('');
    });

    it('returns original string for invalid input', () => {
      expect(formatTime12Hour('abc')).toBe('abc');
    });
  });

  describe('parseTimeToMinutes', () => {
    it('parses "09:00" to 540', () => {
      expect(parseTimeToMinutes('09:00')).toBe(540);
    });

    it('parses "00:00" to 0', () => {
      expect(parseTimeToMinutes('00:00')).toBe(0);
    });

    it('parses "23:59" to 1439', () => {
      expect(parseTimeToMinutes('23:59')).toBe(1439);
    });

    it('returns 0 for empty string', () => {
      expect(parseTimeToMinutes('')).toBe(0);
    });

    it('returns 0 for invalid input', () => {
      expect(parseTimeToMinutes('abc')).toBe(0);
    });
  });

  describe('formatMinutesToTimeString', () => {
    it('formats 540 to "09:00"', () => {
      expect(formatMinutesToTimeString(540)).toBe('09:00');
    });

    it('formats 0 to "00:00"', () => {
      expect(formatMinutesToTimeString(0)).toBe('00:00');
    });

    it('formats 1439 to "23:59"', () => {
      expect(formatMinutesToTimeString(1439)).toBe('23:59');
    });

    it('wraps around after 24h', () => {
      expect(formatMinutesToTimeString(1440)).toBe('00:00');
    });
  });

  describe('computeEstimatedEndTime', () => {
    it('calculates end time correctly', () => {
      expect(computeEstimatedEndTime('09:00', 30)).toBe('09:30');
    });

    it('handles hour rollover', () => {
      expect(computeEstimatedEndTime('13:45', 30)).toBe('14:15');
    });

    it('returns empty for empty start time', () => {
      expect(computeEstimatedEndTime('', 30)).toBe('');
    });

    it('returns empty for zero duration', () => {
      expect(computeEstimatedEndTime('09:00', 0)).toBe('');
    });
  });

  describe('isOverdue', () => {
    it('returns false for future date', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const dateStr = futureDate.toISOString().split('T')[0];
      expect(isOverdue(dateStr)).toBe(false);
    });

    it('returns true for past date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);
      const year = pastDate.getFullYear();
      const month = String(pastDate.getMonth() + 1).padStart(2, '0');
      const day = String(pastDate.getDate()).padStart(2, '0');
      expect(isOverdue(`${year}-${month}-${day}`)).toBe(true);
    });

    it('returns false for today', () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      expect(isOverdue(`${year}-${month}-${day}`)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isOverdue('')).toBe(false);
    });
  });
});
