jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '123e4567-e89b-12d3-a456-426614174000'),
}));

import { resolveAttemptKey } from '../src/utils/idempotency';

describe('resolveAttemptKey', () => {
  it('mints a key on the first attempt', () => {
    const attempt = resolveAttemptKey(null, 'sig-1', () => 'key-1');
    expect(attempt).toEqual({ signature: 'sig-1', key: 'key-1' });
  });

  it('reuses the key while the payload signature is unchanged', () => {
    const first = resolveAttemptKey(null, 'sig-1', () => 'key-1');
    const retry = resolveAttemptKey(first, 'sig-1', () => 'key-2');
    expect(retry.key).toBe('key-1');
  });

  it('mints a new key when the payload changes', () => {
    const first = resolveAttemptKey(null, 'sig-1', () => 'key-1');
    const changed = resolveAttemptKey(first, 'sig-2', () => 'key-2');
    expect(changed).toEqual({ signature: 'sig-2', key: 'key-2' });
  });

  it('uses the expo-crypto default generator and stays within the header cap', () => {
    const attempt = resolveAttemptKey(null, 'sig');
    expect(attempt.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(attempt.key.length).toBeLessThanOrEqual(100);
  });
});
