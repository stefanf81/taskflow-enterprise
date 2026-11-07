import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'taskflow_auth_token';
const USER_KEY = 'taskflow_user_data';
const EXPIRY_KEY = 'taskflow_token_expires_at';
const REFRESH_TOKEN_KEY = 'taskflow_refresh_token';

// Memory fallback for web or test environments where SecureStore isn't native
const memoryStore = new Map<string, string>();

// In-memory copy of the token, refresh token and expiry: every protected request needs
// token + expiry, and each SecureStore read crosses the native bridge. SecureStore stays
// the persistence layer. `undefined` means "not read yet" (launch, or after a write or
// removal), so the next read goes to SecureStore again.
let cachedToken: string | null | undefined;
let cachedExpiry: number | null | undefined;
let cachedRefreshToken: string | null | undefined;
// Bumped by every credential write and removal: a read that was in flight
// meanwhile must not cache the value it saw (a logout racing a request).
let credentialGeneration = 0;

// Bumped when a session starts (sign-in) or ends (sign-out, rejection), at the moment that is
// requested rather than when its writes finish. Anything begun under an older value belongs to a
// session that is gone (see getSessionEpoch). A renewal continues the session: no bump.
let sessionEpoch = 0;

// Credential batches (a sign-in, a renewal's rotation, a sign-out) run one at a time in call
// order, so a rotation's writes never interleave with a sign-out's removals or a sign-in's writes.
// Reads wait for the batches requested before them, so they never see replaced credentials.
let credentialQueue: Promise<unknown> = Promise.resolve();

function exclusive<T>(batch: () => Promise<T>): Promise<T> {
  const result = credentialQueue.then(batch);
  credentialQueue = result.catch(() => undefined);
  return result;
}

/** A token change also drops the cached expiry: an old expiry says nothing about a new token. */
function invalidateCachedToken(): number {
  cachedToken = undefined;
  cachedExpiry = undefined;
  return ++credentialGeneration;
}

function invalidateCachedExpiry(): number {
  cachedExpiry = undefined;
  return ++credentialGeneration;
}

function invalidateCachedRefreshToken(): number {
  cachedRefreshToken = undefined;
  return ++credentialGeneration;
}

export const storage = {
  /**
   * Which session the stored credentials belong to. Work that read it before it changed (a
   * request, a renewal) is about a session a sign-in or sign-out has replaced: its 401 must not
   * end the new session, and a renewal it started must not store or borrow credentials.
   */
  getSessionEpoch(): number {
    return sessionEpoch;
  },

  /**
   * Stores a new sign-in, replacing whatever was stored (also a refresh token of an earlier
   * session when this one has none). Ends the previous session's epoch at once.
   */
  startSession(session: {
    token: string;
    expiresAt: number;
    refreshToken?: string | null;
    user: object;
  }): Promise<void> {
    sessionEpoch++;
    return exclusive(async () => {
      await storage.setToken(session.token);
      await storage.setTokenExpiry(session.expiresAt);
      if (session.refreshToken) {
        await storage.setRefreshToken(session.refreshToken);
      } else {
        await storage.removeRefreshToken();
      }
      await storage.setUserData(session.user);
    });
  },

  /**
   * Stores the credentials of a renewal begun under `epoch`, unless a sign-in or sign-out has
   * replaced that session since; resolves whether they were stored. The refresh token goes
   * first: the server has already retired the old one, so it is the credential that must
   * survive the app being killed halfway (an old access token is merely renewed again).
   */
  rotateSession(
    epoch: number,
    session: { token: string; expiresAt: number; refreshToken: string },
  ): Promise<boolean> {
    return exclusive(async () => {
      if (epoch !== sessionEpoch) return false;
      await storage.setRefreshToken(session.refreshToken);
      await storage.setToken(session.token);
      await storage.setTokenExpiry(session.expiresAt);
      return true;
    });
  },

  // The single-credential writers below are the building blocks of the batches above; a
  // sign-in or renewal goes through startSession / rotateSession, never through these.

  async setToken(token: string): Promise<void> {
    const generation = invalidateCachedToken();
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
    if (generation === credentialGeneration) cachedToken = token;
  },

  async getToken(): Promise<string | null> {
    await credentialQueue;
    if (cachedToken !== undefined) return cachedToken;
    const generation = credentialGeneration;
    let token: string | null;
    try {
      token =
        Platform.OS === 'web'
          ? memoryStore.get(TOKEN_KEY) || null
          : await SecureStore.getItemAsync(TOKEN_KEY);
    } catch (err) {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      console.warn(
        '[storage] SecureStore.getToken failed, falling back to in-memory storage. Error:',
        err instanceof Error ? err.message : err,
      );
      token = memoryStore.get(TOKEN_KEY) || null;
    }
    if (generation === credentialGeneration) cachedToken = token;
    return token;
  },

  async removeToken(): Promise<void> {
    invalidateCachedToken();
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

  async setRefreshToken(refreshToken: string): Promise<void> {
    const generation = invalidateCachedRefreshToken();
    try {
      if (Platform.OS === 'web') {
        memoryStore.set(REFRESH_TOKEN_KEY, refreshToken);
      } else {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      }
    } catch {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential storage is unavailable.');
      }
      memoryStore.set(REFRESH_TOKEN_KEY, refreshToken);
    }
    if (generation === credentialGeneration) cachedRefreshToken = refreshToken;
  },

  /**
   * The stored refresh token, or null when there is none. An unreadable Keychain/Keystore
   * throws instead: "none" would make callers end a session that may well be intact.
   */
  async getRefreshToken(): Promise<string | null> {
    await credentialQueue;
    if (cachedRefreshToken !== undefined) return cachedRefreshToken;
    const generation = credentialGeneration;
    let refreshToken: string | null;
    try {
      refreshToken =
        Platform.OS === 'web'
          ? memoryStore.get(REFRESH_TOKEN_KEY) || null
          : await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      throw new Error('Secure credential storage is unavailable.');
    }
    if (generation === credentialGeneration) cachedRefreshToken = refreshToken ?? null;
    return refreshToken ?? null;
  },

  async removeRefreshToken(): Promise<void> {
    invalidateCachedRefreshToken();
    try {
      if (Platform.OS === 'web') {
        memoryStore.delete(REFRESH_TOKEN_KEY);
      } else {
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      }
    } catch {
      if (Platform.OS !== 'web') {
        throw new Error('Secure credential removal failed. Please try signing out again.');
      }
      memoryStore.delete(REFRESH_TOKEN_KEY);
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
    const generation = invalidateCachedExpiry();
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
    if (generation === credentialGeneration) cachedExpiry = Number(value);
  },

  /** Absolute expiry (epoch ms) of the stored token, or null when unknown (e.g. pre-upgrade installs). */
  async getTokenExpiry(): Promise<number | null> {
    await credentialQueue;
    if (cachedExpiry !== undefined) return cachedExpiry;
    const generation = credentialGeneration;
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
    const expiry = Number.isFinite(parsed) ? parsed : null;
    if (generation === credentialGeneration) cachedExpiry = expiry;
    return expiry;
  },

  async removeTokenExpiry(): Promise<void> {
    invalidateCachedExpiry();
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
   * Remove every persisted credential (token, refresh token, expiry, user data) and end the
   * session's epoch at once. Each removal is attempted even if an earlier one fails; the first
   * failure is re-thrown afterwards so callers can tell the user local cleanup was incomplete.
   * The refresh token matters most: it outlives the access token (and an app reinstall on iOS),
   * so a logout that could not reach the server must still erase it from the device.
   */
  clearSession(): Promise<void> {
    sessionEpoch++;
    return exclusive(async () => {
      const results = await Promise.allSettled([
        storage.removeToken(),
        storage.removeRefreshToken(),
        storage.removeTokenExpiry(),
        storage.removeUserData(),
      ]);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    });
  },
};
