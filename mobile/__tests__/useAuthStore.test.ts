import { useAuthStore } from '../src/store/useAuthStore';
import { authApi } from '../src/api/auth';
import { storage } from '../src/utils/storage';
import { queryClient } from '../src/query/queryClient';
import { SESSION_EXPIRED_MESSAGE } from '../src/utils/session';
import { freezeDate, restoreClock } from '../test/fakeClock';

jest.mock('../src/api/auth', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    me: jest.fn(),
    logout: jest.fn(),
  },
}));

// Capture what the store registers with the API client (session-ended hook).
// (no initializer: the factory runs while imports load, before this line would execute)
let mockSessionEndedHandler: (() => void) | null | undefined;
jest.mock('../src/api/client', () => ({
  setSessionEndedHandler: (handler: (() => void) | null) => {
    mockSessionEndedHandler = handler;
  },
}));

jest.mock('../src/utils/storage', () => ({
  storage: {
    setToken: jest.fn(),
    getToken: jest.fn(),
    removeToken: jest.fn(),
    setTokenExpiry: jest.fn(),
    getTokenExpiry: jest.fn(),
    removeTokenExpiry: jest.fn(),
    setUserData: jest.fn(),
    removeUserData: jest.fn(),
    clearSession: jest.fn(),
  },
}));

// The handler registered by the real store at import time (later isolated
// module loads overwrite mockSessionEndedHandler).
const storeSessionEndedHandler = mockSessionEndedHandler;

const mobileLoginResponse = (username: string, role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER') => ({
  accessToken: `${username}-jwt`,
  tokenType: 'Bearer' as const,
  expiresIn: 3600,
  username,
  role,
});

const resetState = () =>
  useAuthStore.setState({
    isAuthenticated: false,
    isBootstrapping: false,
    username: null,
    role: null,
    isOffline: false,
    storageUnavailable: false,
    error: null,
    sessionNotice: null,
  });

describe('useAuthStore', () => {
  beforeEach(() => {
    queryClient.clear();
    resetState();
    jest.clearAllMocks();
    (storage.getTokenExpiry as jest.Mock).mockResolvedValue(null);
    (storage.clearSession as jest.Mock).mockResolvedValue(undefined);
    (authApi.logout as jest.Mock).mockResolvedValue(undefined);
  });

  it('starts logged out and bootstrapping', () => {
    jest.isolateModules(() => {
      const { useAuthStore: fresh } = require('../src/store/useAuthStore');
      const state = fresh.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isBootstrapping).toBe(true);
      expect(state.role).toBeNull();
      expect(state.username).toBeNull();
      expect(state.sessionNotice).toBeNull();
    });
  });

  describe('login', () => {
    it('stores the mobile bearer token and its expiry after admin login', async () => {
      freezeDate('2026-08-12T10:00:00Z');
      try {
        (authApi.login as jest.Mock).mockResolvedValueOnce(mobileLoginResponse('admin', 'ROLE_ADMIN'));

        await useAuthStore.getState().login({ username: 'admin', password: 'admin-password' });

        const state = useAuthStore.getState();
        expect(state.isAuthenticated).toBe(true);
        expect(state.username).toBe('admin');
        expect(state.role).toBe('ROLE_ADMIN');
        expect(storage.setToken).toHaveBeenCalledWith('admin-jwt');
        expect(storage.setTokenExpiry).toHaveBeenCalledWith(
          new Date('2026-08-12T10:00:00Z').getTime() + 3600 * 1000,
        );
        expect(storage.setUserData).toHaveBeenCalledWith({ username: 'admin', role: 'ROLE_ADMIN' });
      } finally {
        restoreClock();
      }
    });

    it('stores a customer bearer token after customer login', async () => {
      (authApi.login as jest.Mock).mockResolvedValueOnce(
        mobileLoginResponse('customer1', 'ROLE_CUSTOMER'),
      );

      await useAuthStore.getState().login({ username: 'customer1', password: 'password' });

      expect(useAuthStore.getState().role).toBe('ROLE_CUSTOMER');
      expect(storage.setToken).toHaveBeenCalledWith('customer1-jwt');
    });

    it('clears a previous session notice on login', async () => {
      useAuthStore.setState({ sessionNotice: SESSION_EXPIRED_MESSAGE });
      (authApi.login as jest.Mock).mockResolvedValueOnce(mobileLoginResponse('admin', 'ROLE_ADMIN'));
      await useAuthStore.getState().login({ username: 'admin', password: 'x' });
      expect(useAuthStore.getState().sessionNotice).toBeNull();
    });

    it('surfaces login errors without touching the bootstrapping flag', async () => {
      (authApi.login as jest.Mock).mockRejectedValueOnce({
        response: { status: 401, data: { message: 'Invalid credentials' } },
      });

      await expect(
        useAuthStore.getState().login({ username: 'admin', password: 'wrong' }),
      ).rejects.toThrow('Invalid credentials');
      expect(useAuthStore.getState().error).toBe('Invalid credentials');
      // MOB-1: a failed attempt must never flip the splash flag.
      expect(useAuthStore.getState().isBootstrapping).toBe(false);
    });

    it('shows the retry delay for a throttled login (429 + Retry-After)', async () => {
      (authApi.login as jest.Mock).mockRejectedValueOnce({
        response: { status: 429, data: {}, headers: { 'retry-after': '42' } },
      });

      await expect(
        useAuthStore.getState().login({ username: 'admin', password: 'wrong' }),
      ).rejects.toThrow('Too many attempts, try again in 42 s');
      expect(useAuthStore.getState().error).toBe('Too many attempts, try again in 42 s');
    });

    it('falls back to a generic message for non-HTTP failures', async () => {
      (authApi.login as jest.Mock).mockRejectedValueOnce({ response: {} });
      await expect(
        useAuthStore.getState().login({ username: 'admin', password: 'wrong' }),
      ).rejects.toThrow('Login failed');
    });
  });

  describe('register', () => {
    it('handles registration', async () => {
      (authApi.register as jest.Mock).mockResolvedValueOnce(undefined);

      await useAuthStore.getState().register({
        fullName: 'Jane',
        email: 'jane@example.com',
        password: 'password1',
        phone: '+1',
      });

      expect(useAuthStore.getState().isBootstrapping).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('surfaces registration errors', async () => {
      (authApi.register as jest.Mock).mockRejectedValueOnce({
        response: { status: 409, data: { message: 'Email already registered' } },
      });
      await expect(
        useAuthStore.getState().register({
          fullName: 'Jane',
          email: 'jane@example.com',
          password: 'password1',
          phone: '+1',
        }),
      ).rejects.toThrow('Email already registered');
      expect(useAuthStore.getState().error).toBe('Email already registered');
    });
  });

  describe('logout', () => {
    it('revokes the token server-side, then clears local credentials and caches', async () => {
      useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
      queryClient.setQueryData(['customerAppointments', 0, 10], { content: ['private appointment'] });

      await useAuthStore.getState().logout();

      expect(authApi.logout).toHaveBeenCalledTimes(1);
      expect(storage.clearSession).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().username).toBeNull();
      expect(useAuthStore.getState().sessionNotice).toBeNull();
      expect(queryClient.getQueryData(['customerAppointments', 0, 10])).toBeUndefined();
    });

    it('still signs out locally when the revoke call fails (offline)', async () => {
      (authApi.logout as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
      useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });

      await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

      expect(storage.clearSession).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('clears in-memory state and rejects with a notice when secure deletion fails', async () => {
      (storage.clearSession as jest.Mock).mockRejectedValueOnce(
        new Error('Secure credential removal failed. Please try signing out again.'),
      );
      useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
      queryClient.setQueryData(['appointments'], { content: ['private'] });

      await expect(useAuthStore.getState().logout()).rejects.toThrow(/Secure credential removal failed/);

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.role).toBeNull();
      expect(queryClient.getQueryData(['appointments'])).toBeUndefined();
      expect(state.sessionNotice).toMatch(/could not remove saved credentials/i);
    });

    it('uses a default message when the cleanup failure has no message', async () => {
      (storage.clearSession as jest.Mock).mockRejectedValueOnce('boom');
      await expect(useAuthStore.getState().logout()).rejects.toThrow(/Secure sign-out failed/);
    });
  });

  describe('checkAuth', () => {
    it('restores state only when a stored token is confirmed by /me', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce('stored-jwt');
      (authApi.me as jest.Mock).mockResolvedValueOnce({
        username: 'admin',
        role: 'ROLE_ADMIN',
      });
      useAuthStore.setState({ isBootstrapping: true });

      await useAuthStore.getState().checkAuth();

      expect(authApi.me).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().isBootstrapping).toBe(false);
      expect(storage.setUserData).toHaveBeenCalledWith({ username: 'admin', role: 'ROLE_ADMIN' });
    });

    it('does not call /me without a stored bearer token', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce(null);

      await useAuthStore.getState().checkAuth();

      expect(authApi.me).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isBootstrapping).toBe(false);
    });

    it('drops a token past its stored expiry without calling the server and says why', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce('expired-jwt');
      (storage.getTokenExpiry as jest.Mock).mockResolvedValueOnce(Date.now() - 60_000);
      queryClient.setQueryData(['appointments'], { content: ['private'] });

      await useAuthStore.getState().checkAuth();

      expect(authApi.me).not.toHaveBeenCalled();
      expect(storage.clearSession).toHaveBeenCalled();
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isBootstrapping).toBe(false);
      expect(state.sessionNotice).toBe(SESSION_EXPIRED_MESSAGE);
      expect(queryClient.getQueryData(['appointments'])).toBeUndefined();
    });

    it('still ends the session in memory when clearing the expired token fails', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce('expired-jwt');
      (storage.getTokenExpiry as jest.Mock).mockResolvedValueOnce(Date.now() - 1);
      (storage.clearSession as jest.Mock).mockRejectedValueOnce(new Error('keychain'));

      await useAuthStore.getState().checkAuth();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().sessionNotice).toBe(SESSION_EXPIRED_MESSAGE);
    });

    it('keeps a token with an unknown expiry (pre-upgrade install) and lets /me decide', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce('legacy-jwt');
      (storage.getTokenExpiry as jest.Mock).mockResolvedValueOnce(null);
      (authApi.me as jest.Mock).mockResolvedValueOnce({ username: 'admin', role: 'ROLE_ADMIN' });

      await useAuthStore.getState().checkAuth();

      expect(authApi.me).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('clears state and shows the notice when /me definitively rejects the stored token', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce('expired-jwt');
      (authApi.me as jest.Mock).mockRejectedValueOnce({ response: { status: 401 } });
      useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });

      await useAuthStore.getState().checkAuth();

      expect(storage.clearSession).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().role).toBeNull();
      expect(useAuthStore.getState().sessionNotice).toBe(SESSION_EXPIRED_MESSAGE);
    });

    it('preserves credentials and exposes retry state when /me is offline', async () => {
      (storage.getToken as jest.Mock).mockResolvedValueOnce('stored-jwt');
      (authApi.me as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
      useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });

      await useAuthStore.getState().checkAuth();

      expect(storage.clearSession).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().isOffline).toBe(true);
      expect(useAuthStore.getState().isBootstrapping).toBe(false);
    });

    it('reports unavailable secure storage as offline/retry', async () => {
      (storage.getToken as jest.Mock).mockRejectedValueOnce(new Error('Secure credential storage is unavailable.'));

      await useAuthStore.getState().checkAuth();

      expect(useAuthStore.getState().isOffline).toBe(true);
      expect(useAuthStore.getState().error).toMatch(/Secure credential storage is unavailable/);
    });

    it('flags unreadable storage so the UI can offer a way out, and clears the flag once it reads again', async () => {
      (storage.getToken as jest.Mock).mockRejectedValueOnce(new Error('Keystore error'));
      await useAuthStore.getState().checkAuth();
      expect(useAuthStore.getState().storageUnavailable).toBe(true);

      (storage.getToken as jest.Mock).mockResolvedValueOnce(null);
      await useAuthStore.getState().checkAuth();
      expect(useAuthStore.getState().storageUnavailable).toBe(false);
      expect(useAuthStore.getState().isOffline).toBe(false);
    });
  });

  describe('resetSavedSession', () => {
    it('drops the saved sign-in and continues as a guest even if the removal fails', async () => {
      useAuthStore.setState({ isOffline: true, storageUnavailable: true, error: 'x' });
      (storage.clearSession as jest.Mock).mockRejectedValueOnce(new Error('Keystore error'));

      await useAuthStore.getState().resetSavedSession();

      const state = useAuthStore.getState();
      expect(storage.clearSession).toHaveBeenCalled();
      expect(state.isOffline).toBe(false);
      expect(state.storageUnavailable).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.isBootstrapping).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  it('clears an error', () => {
    useAuthStore.setState({ error: 'Some error' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('clears the session notice', () => {
    useAuthStore.setState({ sessionNotice: 'x' });
    useAuthStore.getState().clearSessionNotice();
    expect(useAuthStore.getState().sessionNotice).toBeNull();
  });

  describe('session ended by the API client', () => {
    it('signs the user out and shows the notice when they were authenticated', () => {
      useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
      storeSessionEndedHandler?.();
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.role).toBeNull();
      expect(state.username).toBeNull();
      expect(state.sessionNotice).toBe(SESSION_EXPIRED_MESSAGE);
    });

    it('does not show a notice to a guest', () => {
      storeSessionEndedHandler?.();
      expect(useAuthStore.getState().sessionNotice).toBeNull();
    });
  });
});
