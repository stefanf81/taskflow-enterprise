import { describe, expect, it } from 'vitest';
import { datesOf, rangeOf, shiftDate, stepOf, weekStart } from './calendar';

describe('calendar helpers', () => {
  it('finds the Monday of a week, also from a Sunday and across a month end', () => {
    expect(weekStart('2026-11-24')).toBe('2026-11-23'); // Tuesday
    expect(weekStart('2026-11-23')).toBe('2026-11-23'); // Monday
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sunday belongs to the week before
    expect(weekStart('2026-12-01')).toBe('2026-11-30');
  });

  it('shifts dates across month and year ends', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('turns a view and a day into a range and its dates', () => {
    expect(rangeOf('day', '2026-11-24')).toEqual({
      from: '2026-11-24',
      to: '2026-11-24',
    });
    const week = rangeOf('week', '2026-11-24');
    expect(week).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(datesOf(week)).toHaveLength(7);
    expect(datesOf(rangeOf('day', '2026-11-24'))).toEqual(['2026-11-24']);
    expect(stepOf('day')).toBe(1);
    expect(stepOf('week')).toBe(7);
  });
});
