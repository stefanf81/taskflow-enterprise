import { describe, expect, it } from 'vitest';
import { isCustomerCancellable, normalizePublicId } from './appointment';

describe('appointment rules', () => {
  const now = new Date(2026, 7, 3, 10, 0);
  const booking = (status: string, bookingDate = '2026-08-04', bookingTime = '09:00') => ({
    status,
    bookingDate,
    bookingTime,
  });

  it('lets a customer cancel an upcoming PENDING or APPROVED booking, as the server does', () => {
    expect(isCustomerCancellable(booking('PENDING'), now)).toBe(true);
    expect(isCustomerCancellable(booking('approved'), now)).toBe(true);
    expect(isCustomerCancellable(booking('DENIED'), now)).toBe(false);
    expect(isCustomerCancellable(booking('CANCELLED'), now)).toBe(false);
    expect(isCustomerCancellable(booking('NO_SHOW'), now)).toBe(false);
  });

  it('refuses a booking that has already started', () => {
    expect(isCustomerCancellable(booking('APPROVED', '2026-08-03', '10:00'), now)).toBe(false);
    expect(isCustomerCancellable(booking('APPROVED', '2026-08-03', '11:00'), now)).toBe(true);
  });

  it('normalizes typed booking references', () => {
    expect(normalizePublicId('  ABC-Def ')).toBe('abc-def');
  });
});
