import { describe, expect, it } from 'vitest';
import { isCustomerCancellable, statusLabel } from './appointment-status';

describe('appointment-status', () => {
  it('title-cases known and unknown statuses', () => {
    expect(statusLabel('PENDING')).toBe('Pending');
    expect(statusLabel('CANCELLED')).toBe('Cancelled');
    expect(statusLabel('NO_SHOW')).toBe('No_show');
    expect(statusLabel('')).toBe('');
  });

  it('lets customers cancel only active bookings', () => {
    expect(isCustomerCancellable('PENDING')).toBe(true);
    expect(isCustomerCancellable('APPROVED')).toBe(true);
    expect(isCustomerCancellable('DENIED')).toBe(false);
    expect(isCustomerCancellable('CANCELLED')).toBe(false);
    expect(isCustomerCancellable('pending')).toBe(false);
  });
});
