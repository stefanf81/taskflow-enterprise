/**
 * Number and date formatting for templates, without Angular's `currency`, `number` and `date`
 * pipes. Those pipes live in `@angular/common`'s shared chunk together with the router's code, so
 * using them in any (lazy) component put their locale data and formatters into the initial bundle
 * of every guest page (~22 kB raw). `Intl` formats the same output with built-in locale data.
 *
 * The formatters are built once: constructing an `Intl` formatter costs about ten times as much as
 * using one, and these run per row on every change detection pass.
 */
import { formatUsd } from '@taskflow/domain';

const AMOUNT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DATE_TIME = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' });

export { formatUsd };

/** `1234.5` → `1,234.50` (the `number: '1.2-2'` pipe); '' for a missing value. */
export function formatAmount(amount: number | null | undefined): string {
  return amount == null || Number.isNaN(amount) ? '' : AMOUNT.format(amount);
}

/**
 * An ISO date-time (a `LocalDateTime` without offset is read as local time, as the `date` pipe
 * does) → `Jan 5, 2026, 9:03:01 AM` (the `date: 'medium'` pipe); '' for a missing or invalid value.
 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME.format(date);
}
