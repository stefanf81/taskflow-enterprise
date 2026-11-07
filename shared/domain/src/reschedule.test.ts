import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_RULES, type ShopRules } from './shop';
import { DEFAULT_TIME_SLOTS } from './time';
import { openSlotsOn, rescheduleDates } from './reschedule';

// Monday 2026-08-03, 10:30 in the shop's wall clock.
const NOW = new Date(2026, 7, 3, 10, 30);

describe('reschedule rules', () => {
  it('offers only grid slots that are still ahead today', () => {
    expect(openSlotsOn('2026-08-03', NOW, DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS)).toEqual([
      '11:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
  });

  it('drops the slots the barber is busy in', () => {
    expect(
      openSlotsOn('2026-08-04', NOW, DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS, ['09:00', '14:00']),
    ).toEqual(['10:00', '11:00', '13:00', '15:00', '16:00']);
  });

  it('keeps to the opening hours of that weekday', () => {
    const shortSaturday: ShopRules = {
      maxAdvanceDays: 30,
      openingHours: [{ dayOfWeek: 6, opens: '10:00', closes: '14:00' }],
    };
    expect(openSlotsOn('2026-08-08', NOW, shortSaturday, DEFAULT_TIME_SLOTS)).toEqual([
      '10:00',
      '11:00',
      '13:00',
    ]);
  });

  it('offers nothing on closed days, in the past or beyond the booking window', () => {
    expect(openSlotsOn('2026-08-09', NOW, DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS)).toEqual([]);
    expect(openSlotsOn('2026-08-02', NOW, DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS)).toEqual([]);
    const shortWindow: ShopRules = { ...DEFAULT_SHOP_RULES, maxAdvanceDays: 2 };
    expect(openSlotsOn('2026-08-06', NOW, shortWindow, DEFAULT_TIME_SLOTS)).toEqual([]);
  });

  it('lists the next open days that still have a slot, skipping closed ones', () => {
    const dates = rescheduleDates(NOW, DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS, 7);
    expect(dates).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-10',
    ]);
  });

  it('skips today once its last slot has started', () => {
    const evening = new Date(2026, 7, 3, 16, 30);
    expect(rescheduleDates(evening, DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS, 1)).toEqual([
      '2026-08-04',
    ]);
  });
});
