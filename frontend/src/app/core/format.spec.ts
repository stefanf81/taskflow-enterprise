import { formatDate, formatNumber, formatCurrency } from '@angular/common';
import { describe, expect, it } from 'vitest';
import { formatAmount, formatDateTime, formatUsd } from './format';

describe('format (same output as the Angular pipes it replaces)', () => {
  it.each([0, 5, 35.5, 1234.5, 1_000_000.129])('formats %s like `currency: USD`', (amount) => {
    expect(formatUsd(amount)).toBe(formatCurrency(amount, 'en-US', '$', 'USD'));
  });

  it.each([0, 5, 35.5, 1234.5, 99.999])('formats %s like `number: 1.2-2`', (amount) => {
    expect(formatAmount(amount)).toBe(formatNumber(amount, 'en-US', '1.2-2'));
  });

  it.each(['2026-01-05T09:03:01', '2026-11-30T23:59:59.123', '2026-07-04T00:00:00'])(
    'formats %s like `date: medium`',
    (value) => {
      // Angular uses U+202F before AM/PM like Intl does; compare the visible text.
      const normalise = (text: string) => text.replace(/\s/g, ' ');
      expect(normalise(formatDateTime(value))).toBe(
        normalise(formatDate(value, 'medium', 'en-US')),
      );
    },
  );

  it('renders nothing for missing or invalid values', () => {
    expect(formatUsd(null)).toBe('');
    expect(formatUsd(undefined)).toBe('');
    expect(formatAmount(Number.NaN)).toBe('');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('');
  });
});
