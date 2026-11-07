import { Platform } from 'react-native';

// ==================== Mock expo-secure-store ====================
const mockSetItemAsync = jest.fn();
const mockGetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();

jest.mock('expo-secure-store', () => ({
  setItemAsync: (...args: any[]) => mockSetItemAsync(...args),
  getItemAsync: (...args: any[]) => mockGetItemAsync(...args),
  deleteItemAsync: (...args: any[]) => mockDeleteItemAsync(...args),
}));

import { storage } from '../src/utils/storage';

describe('storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSetItemAsync.mockResolvedValue(undefined);
    mockGetItemAsync.mockResolvedValue(null);
    mockDeleteItemAsync.mockResolvedValue(undefined);
    // Default to native platform
    (Platform as any).OS = 'ios';
    // Clear the module-level memoryStore and credential cache that persist across tests
    (Platform as any).OS = 'web';
    await storage.clearSession();
    (Platform as any).OS = 'ios';
  });

  // ==================== setToken ====================
  describe('setToken', () => {
    it('stores token via SecureStore on native', async () => {
      await storage.setToken('my-jwt-token');
      expect(mockSetItemAsync).toHaveBeenCalledWith('taskflow_auth_token', 'my-jwt-token');
    });

    it('stores token in memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setToken('my-jwt-token');
      expect(mockSetItemAsync).not.toHaveBeenCalled();
      // Should be retrievable
      const token = await storage.getToken();
      expect(token).toBe('my-jwt-token');
    });

    it('fails closed when SecureStore throws on native', async () => {
      mockSetItemAsync.mockRejectedValue(new Error('SecureStore unavailable'));
      await expect(storage.setToken('fallback-token')).rejects.toThrow('Secure credential storage is unavailable.');
    });
  });

  // ==================== getToken ====================
  describe('getToken', () => {
    it('retrieves token from SecureStore on native', async () => {
      mockGetItemAsync.mockResolvedValue('stored-token');
      const token = await storage.getToken();
      expect(token).toBe('stored-token');
      expect(mockGetItemAsync).toHaveBeenCalledWith('taskflow_auth_token');
    });

    it('returns null when no token stored', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      const token = await storage.getToken();
      expect(token).toBeNull();
    });

    it('retrieves token from memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setToken('web-token');
      const token = await storage.getToken();
      expect(token).toBe('web-token');
      expect(mockGetItemAsync).not.toHaveBeenCalled();
    });

    it('fails closed when SecureStore throws on get', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('Not available'));
      await expect(storage.getToken()).rejects.toThrow('Secure credential storage is unavailable.');
    });

  });

  // ==================== removeToken ====================
  describe('removeToken', () => {
    it('removes token via SecureStore on native', async () => {
      await storage.removeToken();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_auth_token');
    });

    it('removes token from memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setToken('token-to-remove');
      await storage.removeToken();
      const token = await storage.getToken();
      expect(token).toBeNull();
    });

    it('fails closed when SecureStore deletion throws', async () => {
      mockDeleteItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.removeToken()).rejects.toThrow('Secure credential removal failed.');
    });
  });

  // ==================== setUserData ====================
  describe('setUserData', () => {
    it('stores user data as JSON via SecureStore on native', async () => {
      const data = { name: 'John', email: 'john@ex.com' };
      await storage.setUserData(data);
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'taskflow_user_data',
        JSON.stringify(data),
      );
    });

    it('stores user data in memory on web', async () => {
      (Platform as any).OS = 'web';
      const data = { name: 'Web User' };
      await storage.setUserData(data);
      const retrieved = await storage.getUserData<{ name: string }>();
      expect(retrieved).toEqual(data);
    });

    it('fails closed when SecureStore throws', async () => {
      mockSetItemAsync.mockRejectedValue(new Error('fail'));
      const data = { name: 'Fallback' };
      await expect(storage.setUserData(data)).rejects.toThrow('Secure credential storage is unavailable.');
    });
  });

  // ==================== getUserData ====================
  describe('getUserData', () => {
    it('retrieves and parses user data from SecureStore', async () => {
      const data = { name: 'John', role: 'admin' };
      mockGetItemAsync.mockResolvedValue(JSON.stringify(data));
      const result = await storage.getUserData<{ name: string; role: string }>();
      expect(result).toEqual(data);
    });

    it('returns null when no user data', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      const result = await storage.getUserData();
      expect(result).toBeNull();
    });

    it('fails closed when SecureStore read fails', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.getUserData()).rejects.toThrow('Secure credential storage is unavailable.');
    });
  });

  // ==================== removeUserData ====================
  describe('removeUserData', () => {
    it('removes user data via SecureStore on native', async () => {
      await storage.removeUserData();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_user_data');
    });

    it('removes user data from memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setUserData({ temp: true });
      await storage.removeUserData();
      const result = await storage.getUserData();
      expect(result).toBeNull();
    });

    it('fails closed when SecureStore deletion throws', async () => {
      mockDeleteItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.removeUserData()).rejects.toThrow('Secure credential removal failed.');
    });
  });

  // ==================== Cross-operation integrity ====================
  it('getToken returns null after removeToken', async () => {
    mockSetItemAsync.mockResolvedValue();
    mockGetItemAsync.mockResolvedValue('temp');
    mockDeleteItemAsync.mockResolvedValue();
    await storage.setToken('temp');
    // Override get to simulate actual removal
    mockGetItemAsync.mockResolvedValue(null);
    await storage.removeToken();
    const token = await storage.getToken();
    expect(token).toBeNull();
  });

  // ==================== token expiry (MOB-8) ====================
  describe('token expiry', () => {
    it('stores and reads the expiry through SecureStore on native', async () => {
      await storage.setTokenExpiry(1_786_000_000_000.7);
      expect(mockSetItemAsync).toHaveBeenCalledWith('taskflow_token_expires_at', '1786000000000');
      await expect(storage.getTokenExpiry()).resolves.toBe(1_786_000_000_000);

      await storage.removeTokenExpiry();
      mockGetItemAsync.mockResolvedValue('1786000000000');
      await expect(storage.getTokenExpiry()).resolves.toBe(1_786_000_000_000);
      expect(mockGetItemAsync).toHaveBeenCalledWith('taskflow_token_expires_at');
    });

    it('returns null when no or garbage expiry is stored', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      await expect(storage.getTokenExpiry()).resolves.toBeNull();
      await storage.removeTokenExpiry();
      mockGetItemAsync.mockResolvedValue('not-a-number');
      await expect(storage.getTokenExpiry()).resolves.toBeNull();
    });

    it('does not fail requests when the expiry cannot be read', async () => {
      mockGetItemAsync.mockRejectedValue(new Error('keychain locked'));
      await expect(storage.getTokenExpiry()).resolves.toBeNull();
      // An unreadable expiry is not cached: the next request reads it again.
      mockGetItemAsync.mockResolvedValue('1786000000000');
      await expect(storage.getTokenExpiry()).resolves.toBe(1_786_000_000_000);
    });

    it('fails closed when the expiry cannot be written on native', async () => {
      mockSetItemAsync.mockRejectedValue(new Error('nope'));
      await expect(storage.setTokenExpiry(1)).rejects.toThrow('Secure credential storage is unavailable.');
    });

    it('keeps the expiry in memory on web', async () => {
      (Platform as any).OS = 'web';
      await storage.setTokenExpiry(123456);
      expect(mockSetItemAsync).not.toHaveBeenCalled();
      await expect(storage.getTokenExpiry()).resolves.toBe(123456);
      await storage.removeTokenExpiry();
      await expect(storage.getTokenExpiry()).resolves.toBeNull();
    });

    it('removes the expiry via SecureStore and fails closed on error', async () => {
      await storage.removeTokenExpiry();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_token_expires_at');
      mockDeleteItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.removeTokenExpiry()).rejects.toThrow('Secure credential removal failed.');
    });
  });

  // ==================== in-memory credential cache ====================
  describe('credential cache', () => {
    it('reads the token and expiry from SecureStore once, then from memory', async () => {
      mockGetItemAsync.mockImplementation(async (key: string) =>
        key === 'taskflow_auth_token' ? 'stored-token' : '1786000000000',
      );
      for (let i = 0; i < 3; i++) {
        await expect(storage.getToken()).resolves.toBe('stored-token');
        await expect(storage.getTokenExpiry()).resolves.toBe(1_786_000_000_000);
      }
      expect(mockGetItemAsync).toHaveBeenCalledTimes(2);
    });

    it('serves a freshly stored token without a SecureStore read', async () => {
      await storage.setToken('login-token');
      await storage.setTokenExpiry(1_786_000_000_000);
      await expect(storage.getToken()).resolves.toBe('login-token');
      await expect(storage.getTokenExpiry()).resolves.toBe(1_786_000_000_000);
      expect(mockGetItemAsync).not.toHaveBeenCalled();
    });

    it('drops the cached expiry when a new token is stored', async () => {
      await storage.setTokenExpiry(1);
      await storage.setToken('next-token');
      mockGetItemAsync.mockResolvedValue(null);
      await expect(storage.getTokenExpiry()).resolves.toBeNull();
      expect(mockGetItemAsync).toHaveBeenCalledWith('taskflow_token_expires_at');
    });

    it('forgets the token on clearSession, even when the deletion fails', async () => {
      await storage.setToken('session-token');
      mockDeleteItemAsync.mockRejectedValue(new Error('fail'));
      await expect(storage.clearSession()).rejects.toThrow('Secure credential removal failed.');
      // Not served from memory any more; SecureStore stays the authority.
      mockGetItemAsync.mockResolvedValue(null);
      await expect(storage.getToken()).resolves.toBeNull();
      expect(mockGetItemAsync).toHaveBeenCalledWith('taskflow_auth_token');
    });

    it('does not cache a token read that a logout overtook', async () => {
      let finishRead!: (value: string) => void;
      mockGetItemAsync.mockImplementationOnce(
        () => new Promise<string>((resolve) => (finishRead = resolve)),
      );
      const inFlight = storage.getToken();
      await storage.clearSession();
      finishRead('revoked-token');
      await expect(inFlight).resolves.toBe('revoked-token');

      mockGetItemAsync.mockResolvedValue(null);
      await expect(storage.getToken()).resolves.toBeNull();
    });

    it('does not cache a token SecureStore failed to read', async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error('locked'));
      await expect(storage.getToken()).rejects.toThrow('Secure credential storage is unavailable.');
      mockGetItemAsync.mockResolvedValue('stored-token');
      await expect(storage.getToken()).resolves.toBe('stored-token');
    });
  });

  // ==================== clearSession ====================
  describe('clearSession', () => {
    it('removes token, refresh token, expiry and user data', async () => {
      await storage.clearSession();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_auth_token');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_refresh_token');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_token_expires_at');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_user_data');
    });

    it('attempts every removal even if one fails, then reports the failure', async () => {
      mockDeleteItemAsync.mockImplementation(async (key: string) => {
        if (key === 'taskflow_auth_token') throw new Error('fail');
      });
      await expect(storage.clearSession()).rejects.toThrow('Secure credential removal failed.');
      expect(mockDeleteItemAsync).toHaveBeenCalledTimes(4);
    });

    it('erases the refresh token from SecureStore, not just from memory', async () => {
      await storage.setRefreshToken('r'.repeat(43));
      await storage.clearSession();
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('taskflow_refresh_token');
      mockGetItemAsync.mockResolvedValue(null);
      await expect(storage.getRefreshToken()).resolves.toBeNull();
      expect(mockGetItemAsync).toHaveBeenCalledWith('taskflow_refresh_token');
    });
  });

  // ==================== refresh token ====================
  describe('refresh token', () => {
    it('persists the refresh token in SecureStore and serves it from memory afterwards', async () => {
      await storage.setRefreshToken('a'.repeat(43));
      expect(mockSetItemAsync).toHaveBeenCalledWith('taskflow_refresh_token', 'a'.repeat(43));
      mockGetItemAsync.mockClear();
      await expect(storage.getRefreshToken()).resolves.toBe('a'.repeat(43));
      expect(mockGetItemAsync).not.toHaveBeenCalled();
    });

    it('refuses to fall back to plaintext memory when SecureStore cannot store it', async () => {
      mockSetItemAsync.mockRejectedValueOnce(new Error('locked'));
      await expect(storage.setRefreshToken('b'.repeat(43))).rejects.toThrow(
        'Secure credential storage is unavailable.',
      );
    });

    it('fails closed (never "no refresh token") when SecureStore cannot read it', async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error('locked'));
      await expect(storage.getRefreshToken()).rejects.toThrow(
        'Secure credential storage is unavailable.',
      );
      // Not cached: the next read asks SecureStore again.
      mockGetItemAsync.mockResolvedValue('c'.repeat(43));
      await expect(storage.getRefreshToken()).resolves.toBe('c'.repeat(43));
    });

    it('does not cache a refresh-token read that a logout overtook', async () => {
      let finishRead!: (value: string) => void;
      mockGetItemAsync.mockImplementationOnce(
        () => new Promise<string>((resolve) => (finishRead = resolve)),
      );
      const inFlight = storage.getRefreshToken();
      await storage.clearSession();
      finishRead('d'.repeat(43));
      await expect(inFlight).resolves.toBe('d'.repeat(43));

      mockGetItemAsync.mockResolvedValue(null);
      await expect(storage.getRefreshToken()).resolves.toBeNull();
    });
  });

  // ==================== session batches ====================
  describe('session batches', () => {
    /** SecureStore as a map, so the final state of interleaved batches can be checked. */
    const useDisk = () => {
      const disk = new Map<string, string>();
      mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
        disk.set(key, value);
      });
      mockGetItemAsync.mockImplementation(async (key: string) => disk.get(key) ?? null);
      mockDeleteItemAsync.mockImplementation(async (key: string) => {
        disk.delete(key);
      });
      return disk;
    };
    const rotation = { token: 'renewed', expiresAt: 1_786_000_000_000, refreshToken: 'n'.repeat(43) };

    it('starts a sign-in with a new epoch at once and stores all of it', async () => {
      const disk = useDisk();
      const before = storage.getSessionEpoch();

      const started = storage.startSession({
        token: 'login',
        expiresAt: 1_786_000_000_000,
        refreshToken: 'a'.repeat(43),
        user: { username: 'jane', role: 'ROLE_CUSTOMER' },
      });
      expect(storage.getSessionEpoch()).toBe(before + 1);
      await started;

      expect(disk.get('taskflow_auth_token')).toBe('login');
      expect(disk.get('taskflow_token_expires_at')).toBe('1786000000000');
      expect(disk.get('taskflow_refresh_token')).toBe('a'.repeat(43));
      expect(JSON.parse(disk.get('taskflow_user_data')!)).toEqual({
        username: 'jane',
        role: 'ROLE_CUSTOMER',
      });
    });

    it('drops an earlier refresh token when the new sign-in has none', async () => {
      const disk = useDisk();
      await storage.setRefreshToken('o'.repeat(43));

      await storage.startSession({ token: 'login', expiresAt: 1, user: {} });

      expect(disk.has('taskflow_refresh_token')).toBe(false);
      await expect(storage.getRefreshToken()).resolves.toBeNull();
    });

    it("stores a renewal for its own session, the server's new refresh token first", async () => {
      const disk = useDisk();

      await expect(storage.rotateSession(storage.getSessionEpoch(), rotation)).resolves.toBe(true);

      expect(mockSetItemAsync.mock.calls.map(([key]) => key)).toEqual([
        'taskflow_refresh_token',
        'taskflow_auth_token',
        'taskflow_token_expires_at',
      ]);
      expect(disk.get('taskflow_auth_token')).toBe('renewed');
      await expect(storage.getRefreshToken()).resolves.toBe('n'.repeat(43));
    });

    it('stores nothing from a renewal of a session a sign-out already ended', async () => {
      useDisk();
      const epoch = storage.getSessionEpoch();
      const signedOut = storage.clearSession();

      await expect(storage.rotateSession(epoch, rotation)).resolves.toBe(false);
      await signedOut;
      expect(mockSetItemAsync).not.toHaveBeenCalled();
    });

    it('lets a sign-out requested during a rotation run after it, so nothing survives', async () => {
      const disk = useDisk();
      let releaseTokenWrite: (() => void) | undefined;
      mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
        if (key === 'taskflow_auth_token') {
          await new Promise<void>((resolve) => (releaseTokenWrite = resolve));
        }
        disk.set(key, value);
      });

      const rotating = storage.rotateSession(storage.getSessionEpoch(), rotation);
      // Halfway: the refresh token is written, the access token write is still pending.
      for (let i = 0; i < 100 && !releaseTokenWrite; i++) await Promise.resolve();
      expect(disk.get('taskflow_refresh_token')).toBe('n'.repeat(43));
      const signedOut = storage.clearSession();
      releaseTokenWrite!();
      await expect(rotating).resolves.toBe(true);
      await signedOut;

      expect(disk.size).toBe(0);
      await expect(storage.getToken()).resolves.toBeNull();
      await expect(storage.getRefreshToken()).resolves.toBeNull();
    });

    it('makes reads wait for a sign-out requested before them', async () => {
      useDisk();
      await storage.setToken('session-token');

      const signedOut = storage.clearSession();
      await expect(storage.getToken()).resolves.toBeNull();
      await signedOut;
    });
  });
});
