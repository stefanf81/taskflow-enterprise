export * from './time';
export * from './shop';
export * from './appointment';
export * from './reschedule';

const USD_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** `1234.5` -> `$1,234.50` (shared across web and mobile); `''` for a missing or NaN value. */
export function formatUsd(amount: number | null | undefined): string {
  return amount == null || Number.isNaN(amount) ? '' : USD_FORMAT.format(amount);
}
