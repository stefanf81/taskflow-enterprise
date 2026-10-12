import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'taskflow_auth_token';
const USER_KEY = 'taskflow_user_data';
const EXPIRY_KEY = 'taskflow_token_expires_at';

// Memory fallback for web or test environments where SecureStore isn't native
const memoryStore = new Map<string, string>();

export const storage = {
  async setToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.set(TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(TOKEN_KEY, token);
      }
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      console.warn(
        '[storage] SecureStore.setToken failed, falling back to in-memory storage. ' +
        'Token will be lost on app restart. Error:',
        err instanceof Error ? err.message : err,
      );
      memoryStore.set(TOKEN_KEY, token);
    }
  },

  async getToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return memoryStore.get(TOKEN_KEY) || null;
      }
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      console.warn(
        '[storage] SecureStore.getToken failed, falling back to in-memory storage. Error:',
        err instanceof Error ? err.message : err,
      );
      return memoryStore.get(TOKEN_KEY) || null;
    }
  },

  async removeToken(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.delete(TOKEN_KEY);
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
      }
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential removal failed. Please try signing out again.');
      }
      console.warn(
        '[storage] SecureStore.removeToken failed, falling back to in-memory removal. Error:',
        err instanceof Error ? err.message : err,
      );
      memoryStore.delete(TOKEN_KEY);
    }
  },

  async setUserData(data: object): Promise<void> {
    const json = JSON.stringify(data);
    try {
      if (Platform.OS === 'web') {
        memoryStore.set(USER_KEY, json);
      } else {
        await SecureStore.setItemAsync(USER_KEY, json);
      }
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      console.warn(
        '[storage] SecureStore.setUserData failed, falling back to in-memory storage. Error:',
        err instanceof Error ? err.message : err,
      );
      memoryStore.set(USER_KEY, json);
    }
  },

  async getUserData<T>(): Promise<T | null> {
    try {
      let json: string | null = null;
      if (Platform.OS === 'web') {
        json = memoryStore.get(USER_KEY) || null;
      } else {
        json = await SecureStore.getItemAsync(USER_KEY);
      }
      return json ? (JSON.parse(json) as T) : null;
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      console.warn(
        '[storage] SecureStore.getUserData failed, falling back to in-memory storage. Error:',
        err instanceof Error ? err.message : err,
      );
      try {
        const json = memoryStore.get(USER_KEY);
        return json ? (JSON.parse(json) as T) : null;
      } catch {
        return null;
      }
    }
  },

  async removeUserData(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.delete(USER_KEY);
      } else {
        await SecureStore.deleteItemAsync(USER_KEY);
      }
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential removal failed. Please try signing out again.');
      }
      console.warn(
        '[storage] SecureStore.removeUserData failed, falling back to in-memory removal. Error:',
        err instanceof Error ? err.message : err,
      );
      memoryStore.delete(USER_KEY);
    }
  },

  /** Persist the absolute expiry (epoch ms) of the stored bearer token. */
  async setTokenExpiry(expiresAtMs: number): Promise<void> {
    const value = String(Math.trunc(expiresAtMs));
    try {
      if (Platform.OS === 'web') {
        memoryStore.set(EXPIRY_KEY, value);
      } else {
        await SecureStore.setItemAsync(EXPIRY_KEY, value);
      }
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      console.warn(
        '[storage] SecureStore.setTokenExpiry failed, falling back to in-memory storage. Error:',
        err instanceof Error ? err.message : err,
      );
      memoryStore.set(EXPIRY_KEY, value);
    }
  },

  /** Absolute expiry (epoch ms) of the stored token, or null when unknown (e.g. pre-upgrade installs). */
  async getTokenExpiry(): Promise<number | null> {
    let raw: string | null;
    try {
      raw =
        Platform.OS === 'web'
          ? (memoryStore.get(EXPIRY_KEY) ?? null)
          : await SecureStore.getItemAsync(EXPIRY_KEY);
    } catch {
      // An unreadable expiry must not block the request; the server remains the authority.
      return null;
    }
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  },

  async removeTokenExpiry(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        memoryStore.delete(EXPIRY_KEY);
      } else {
        await SecureStore.deleteItemAsync(EXPIRY_KEY);
      }
    } catch {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential removal failed. Please try signing out again.');
      }
      memoryStore.delete(EXPIRY_KEY);
    }
  },

  /**
   * Remove every persisted credential (token, expiry, user data). Each removal
   * is attempted even if an earlier one fails; the first failure is re-thrown
   * afterwards so callers can tell the user local cleanup was incomplete.
   */
  async clearSession(): Promise<void> {
    const results = await Promise.allSettled([
      storage.removeToken(),
      storage.removeTokenExpiry(),
      storage.removeUserData(),
    ]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  },
};
