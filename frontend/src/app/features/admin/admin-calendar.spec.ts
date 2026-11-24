import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';
import { AppointmentResponse } from '../../types/api';
import {
  buildGrid,
  calendarHours,
  datesOf,
  hourLabel,
  rangeOf,
  shiftDate,
  stepOf,
  weekStart,
} from './admin-calendar';

const booking = (
  id: number,
  barberName: string,
  bookingDate: string,
  bookingTime: string,
): AppointmentResponse => ({
  id,
  publicId: `p${id}`,
  customerName: `C${id}`,
  customerEmail: 'c@example.com',
  customerPhone: '1',
  barberName,
  bookingDate,
  bookingTime,
  serviceType: 'Cut',
  status: 'APPROVED',
  createdAt: '',
  updatedAt: '',
});

describe('admin calendar helpers', () => {
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
    expect(rangeOf('day', '2026-11-24')).toEqual({ from: '2026-11-24', to: '2026-11-24' });
    const week = rangeOf('week', '2026-11-24');
    expect(week).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(datesOf(week)).toHaveLength(7);
    expect(datesOf(rangeOf('day', '2026-11-24'))).toEqual(['2026-11-24']);
    expect(stepOf('day')).toBe(1);
    expect(stepOf('week')).toBe(7);
  });

  it('labels hours on a 12 hour clock', () => {
    expect([0, 9, 12, 13, 23].map(hourLabel)).toEqual(['12 AM', '9 AM', '12 PM', '1 PM', '11 PM']);
  });

  describe('calendarHours', () => {
    const tuesday = ['2026-11-24'];

    it('covers opening to closing, the closing hour excluded', () => {
      expect(calendarHours(DEFAULT_SHOP_RULES, tuesday, [])).toEqual([
        9, 10, 11, 12, 13, 14, 15, 16,
      ]);
    });

    it('keeps a half hour closing as a row', () => {
      const rules = {
        ...DEFAULT_SHOP_RULES,
        openingHours: [{ dayOfWeek: 2, opens: '08:30', closes: '17:30' }],
      };
      const hours = calendarHours(rules, tuesday, []);
      expect(hours[0]).toBe(8);
      expect(hours.at(-1)).toBe(17);
    });

    it('spans the earliest opening and latest closing of the days shown', () => {
      const rules = {
        ...DEFAULT_SHOP_RULES,
        openingHours: [
          { dayOfWeek: 2, opens: '10:00', closes: '14:00' },
          { dayOfWeek: 3, opens: '08:00', closes: '19:00' },
        ],
      };
      const hours = calendarHours(rules, ['2026-11-24', '2026-11-25'], []);
      expect([hours[0], hours.at(-1)]).toEqual([8, 18]);
    });

    it('falls back to 9-17 when the shop is closed on every day shown', () => {
      const sunday = ['2026-11-29'];
      expect(calendarHours(DEFAULT_SHOP_RULES, sunday, [])).toEqual([
        9, 10, 11, 12, 13, 14, 15, 16,
      ]);
    });

    it('widens for a booking outside the current hours', () => {
      const hours = calendarHours(DEFAULT_SHOP_RULES, tuesday, [
        { bookingTime: '07:00' },
        { bookingTime: '18:30' },
      ]);
      expect([hours[0], hours.at(-1)]).toEqual([7, 18]);
    });
  });

  describe('buildGrid', () => {
    const appointments = [
      booking(3, 'Sara', '2026-11-24', '10:30'),
      booking(1, 'Alex', '2026-11-24', '10:00'),
      booking(2, 'Alex', '2026-11-24', '10:30'),
      booking(4, 'Gone', '2026-11-24', '11:00'),
    ];

    it('puts bookings in the hour row and barber column they belong to, earliest first', () => {
      const rows = buildGrid(appointments, ['Alex', 'Sara'], (a) => a.barberName, [10, 11]);
      expect(rows.map((row) => row.hour)).toEqual([10, 11]);
      expect(rows[0]!.cells[0]!.map((a) => a.id)).toEqual([1, 2]);
      expect(rows[0]!.cells[1]!.map((a) => a.id)).toEqual([3]);
      expect(rows[1]!.cells.map((cell) => cell.length)).toEqual([0, 0]);
    });

    it('leaves out a booking whose column is not shown (a barber filter)', () => {
      const rows = buildGrid(appointments, ['Sara'], (a) => a.barberName, [10, 11]);
      expect(rows.flatMap((row) => row.cells.flat()).map((a) => a.id)).toEqual([3]);
    });
  });
});
