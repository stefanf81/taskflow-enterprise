import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIME_SLOTS,
  computeEstimatedEndTime,
  formatLocalDate,
  formatMinutesToTimeString,
  formatTime12Hour,
  isOverdue,
  parseTimeToMinutes,
} from './time-utils';

describe('time-utils', () => {
  describe('formatTime12Hour', () => {
    it('formats morning, noon, afternoon and midnight correctly', () => {
      expect(formatTime12Hour('09:00')).toBe('9:00 AM');
      expect(formatTime12Hour('12:00')).toBe('12:00 PM');
      expect(formatTime12Hour('13:30')).toBe('1:30 PM');
      expect(formatTime12Hour('00:15')).toBe('12:15 AM');
    });

    it('defaults a missing minutes part to 00', () => {
      expect(formatTime12Hour('7')).toBe('7:00 AM');
    });

    it('returns empty string for empty input and the raw value for unparseable input', () => {
      expect(formatTime12Hour('')).toBe('');
      expect(formatTime12Hour('abc')).toBe('abc');
    });
  });

  describe('parseTimeToMinutes', () => {
    it('parses HH:MM into minutes since midnight', () => {
      expect(parseTimeToMinutes('09:30')).toBe(570);
      expect(parseTimeToMinutes('00:00')).toBe(0);
    });

    it('falls back to 0 for empty or malformed input', () => {
      expect(parseTimeToMinutes('')).toBe(0);
      expect(parseTimeToMinutes('not-a-time')).toBe(0);
    });
  });

  describe('formatMinutesToTimeString', () => {
    it('zero-pads hours and minutes', () => {
      expect(formatMinutesToTimeString(570)).toBe('09:30');
      expect(formatMinutesToTimeString(0)).toBe('00:00');
    });

    it('wraps around past midnight', () => {
      expect(formatMinutesToTimeString(24 * 60 + 10)).toBe('00:10');
    });
  });

  describe('computeEstimatedEndTime', () => {
    it('adds the service duration to the start time', () => {
      expect(computeEstimatedEndTime('09:00', 45)).toBe('09:45');
    });

    it('returns an empty string when either input is missing', () => {
      expect(computeEstimatedEndTime('', 30)).toBe('');
      expect(computeEstimatedEndTime('09:00', 0)).toBe('');
    });
  });

  describe('formatLocalDate', () => {
    it('renders a date-only string in the local timezone without a day shift', () => {
      expect(formatLocalDate('2026-08-01')).toBe('August 1, 2026');
    });

    it('returns empty string for empty input and the raw value when invalid', () => {
      expect(formatLocalDate('')).toBe('');
      expect(formatLocalDate('not-a-date')).toBe('not-a-date');
    });
  });

  describe('isOverdue', () => {
    it('flags past dates and accepts both string and object input', () => {
      expect(isOverdue('2000-01-01')).toBe(true);
      expect(isOverdue('2999-12-31')).toBe(false);
      expect(isOverdue({ bookingDate: '2000-01-01' })).toBe(true);
    });

    it('returns false for missing values', () => {
      expect(isOverdue('')).toBe(false);
      expect(isOverdue({})).toBe(false);
    });
  });

  it('exposes a non-empty default slot list', () => {
    expect(DEFAULT_TIME_SLOTS.length).toBeGreaterThan(0);
    expect(DEFAULT_TIME_SLOTS).toContain('09:00');
  });
});
