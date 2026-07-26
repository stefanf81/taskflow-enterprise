/**
 * sslPinning tests.
 *
 * In the test environment, `__DEV__` is set to `true` by default by the
 * React Native Jest preset. We use `Object.defineProperty` on `globalThis`
 * to toggle it for specific test cases.
 */

// Save original __DEV__ value
const originalDev = globalThis.__DEV__;

import { getSslPinningConfig } from '../src/utils/sslPinning';

describe('getSslPinningConfig', () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS;
  });

  afterAll(() => {
    // Restore original __DEV__
    Object.defineProperty(globalThis, '__DEV__', { value: originalDev, configurable: true });
  });

  it('returns null when __DEV__ is true (default)', () => {
    // By default __DEV__ should be true in test environment
    const result = getSslPinningConfig();
    expect(result).toBeNull();
  });

  describe('when __DEV__ is false', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
    });

    it('returns null when env var is not set', () => {
      const result = getSslPinningConfig();
      expect(result).toBeNull();
    });

    it('returns null when env var is empty', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS = '';
      const result = getSslPinningConfig();
      expect(result).toBeNull();
    });

    it('returns null when env var is only whitespace', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS = '   ';
      const result = getSslPinningConfig();
      expect(result).toBeNull();
    });

    it('returns config with single valid fingerprint', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const result = getSslPinningConfig();
      expect(result).toEqual({
        fingerprints: ['sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
      });
    });

    it('returns config with multiple valid fingerprints', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS =
        'sha256/AAAA==,sha256/BBBB==';
      const result = getSslPinningConfig();
      expect(result).toEqual({
        fingerprints: ['sha256/AAAA==', 'sha256/BBBB=='],
      });
    });

    it('filters out invalid fingerprints', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS =
        'sha256/valid==,md5/bad,sha256/,sha256/ok==';
      const result = getSslPinningConfig();
      expect(result).toEqual({
        fingerprints: ['sha256/valid==', 'sha256/ok=='],
      });
    });

    it('returns null when no valid fingerprints after filtering', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS = 'md5/bad,invalid';
      const result = getSslPinningConfig();
      expect(result).toBeNull();
    });

    it('trims whitespace from fingerprints', () => {
      process.env.EXPO_PUBLIC_SSL_PIN_FINGERPRINTS = '  sha256/AAAA== , sha256/BBBB==  ';
      const result = getSslPinningConfig();
      expect(result).toEqual({
        fingerprints: ['sha256/AAAA==', 'sha256/BBBB=='],
      });
    });
  });
});
