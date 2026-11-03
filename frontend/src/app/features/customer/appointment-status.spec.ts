import { describe, expect, it } from 'vitest';
import { statusLabel } from './appointment-status';

describe('appointment-status', () => {
  it('title-cases known and unknown statuses', () => {
    expect(statusLabel('PENDING')).toBe('Pending');
    expect(statusLabel('CANCELLED')).toBe('Cancelled');
    expect(statusLabel('NO_SHOW')).toBe('No_show');
    expect(statusLabel('')).toBe('');
  });
});
