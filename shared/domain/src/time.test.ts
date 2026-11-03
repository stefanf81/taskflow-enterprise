import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeEstimatedEndTime,
  formatTime12Hour,
  isOverdue,
  isSlotInPast,
  parseTimeToMinutes,
  shopWallClock,
  toLocalDateString,
} from './time';

describe('time helpers', () => {
  it('formats 24h times as 12h and leaves junk alone', () => {
    expect(formatTime12Hour('00:30')).toBe('12:30 AM');
    expect(formatTime12Hour('13:05')).toBe('1:05 PM');
    expect(formatTime12Hour('12')).toBe('12:00 PM');
    expect(formatTime12Hour('soon')).toBe('soon');
    expect(formatTime12Hour('')).toBe('');
  });

  it('adds a duration to a start time', () => {
    expect(parseTimeToMinutes('09:45')).toBe(585);
    expect(computeEstimatedEndTime('16:30', 45)).toBe('17:15');
    expect(computeEstimatedEndTime('23:30', 60)).toBe('00:30');
    expect(computeEstimatedEndTime('', 30)).toBe('');
  });

  it('builds dates from local components, never UTC', () => {
    const lateEvening = new Date(2026, 7, 1, 23, 30);
    expect(toLocalDateString(lateEvening)).toBe('2026-08-01');
    expect(addDays(lateEvening, 1)).toBe('2026-08-02');
    expect(addDays(new Date(2026, 1, 28), 1)).toBe('2026-03-01');
  });

  it('treats a slot that has started as past', () => {
    const now = new Date(2026, 7, 3, 10, 0);
    expect(isSlotInPast('2026-08-03', '10:00', now)).toBe(true);
    expect(isSlotInPast('2026-08-03', '11:00', now)).toBe(false);
    expect(isSlotInPast('2026-08-02', '16:00', now)).toBe(true);
    expect(isSlotInPast('2026-08-04', '09:00', now)).toBe(false);
  });

  it('flags bookings dated before today as overdue', () => {
    const now = new Date(2026, 7, 3, 9, 0);
    expect(isOverdue('2026-08-02', now)).toBe(true);
    expect(isOverdue({ bookingDate: '2026-08-03' }, now)).toBe(false);
    expect(isOverdue({}, now)).toBe(false);
  });

  it("reads the wall clock in the shop's zone", () => {
    const instant = new Date('2026-03-02T23:30:00Z');
    const berlin = shopWallClock('Europe/Berlin', instant);
    expect(toLocalDateString(berlin)).toBe('2026-03-03');
    expect(berlin.getHours()).toBe(0);
    expect(shopWallClock('Not/AZone', instant)).toBe(instant);
    expect(shopWallClock(null, instant)).toBe(instant);
  });
});
