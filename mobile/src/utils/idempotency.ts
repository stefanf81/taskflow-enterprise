import * as Crypto from 'expo-crypto';

export interface AttemptKey {
  signature: string;
  key: string;
}

/** Cryptographically-random idempotency key (36 chars, within the backend's 100 cap). */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

/**
 * Reuses `previous.key` while the payload signature is unchanged, and mints a
 * new key otherwise. Keeping the key stable across an ambiguous timeout +
 * re-tap lets the backend replay the original booking instead of creating a
 * second one (a "No Preference" retry can otherwise land on a different barber).
 */
export function resolveAttemptKey(
  previous: AttemptKey | null,
  signature: string,
  generate: () => string = newIdempotencyKey,
): AttemptKey {
  if (previous !== null && previous.signature === signature) {
    return previous;
  }
  return { signature, key: generate() };
}
