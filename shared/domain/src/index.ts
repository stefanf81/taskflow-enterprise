export * from './time';
export * from './shop';
export * from './appointment';
export * from './reschedule';
export * from './ratings';

// Built on first use, not when the module loads: every importer's cold start paid for it, also
// screens that format no price (BENCHMARKS.md §79).
let usdFormat: Intl.NumberFormat | undefined;

/** `1234.5` -> `$1,234.50` (shared across web and mobile); `''` for a missing or NaN value. */
export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '';
  usdFormat ??= new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  return usdFormat.format(amount);
}
