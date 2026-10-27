import { create } from 'zustand';
import { storage } from '../../utils/storage';
import { authApi } from './auth';
import { setSessionEndedHandler } from '../../api/client';
import { LoginRequest, LoginResponse, RegisterRequest } from '../../types/api';
import { queryClient } from '../../query/queryClient';
import { getApiErrorMessage, getHttpStatus } from '../../utils/errors';
import { SESSION_EXPIRED_MESSAGE, computeExpiryMs, isTokenExpired } from '../../utils/session';

interface AuthState {
  isAuthenticated: boolean;
  /**
   * True only while `checkAuth` restores the session at startup/retry. The
   * RootNavigator shows its splash for this flag alone; login/register keep
   * their pending state local to the screens so the NavigationContainer (and
   * therefore the screen that renders the error) is never unmounted mid-submit.
   */
  isBootstrapping: boolean;
  username: string | null;
  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER' | null;
  isOffline: boolean;
  /**
   * True when the saved sign-in could not even be read (Keychain/Keystore error), as opposed to
   * the server being unreachable. Retrying may help once; if it keeps failing the user needs
   * `resetSavedSession`, otherwise the app would be unusable for good.
   */
  storageUnavailable: boolean;
  error: string | null;
  /** Shown app-wide after the session ended without a user-initiated sign-out. */
  sessionNotice: string | null;

  login: (credentials: LoginRequest) => Promise<LoginResponse>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  /** Drops the saved sign-in and continues as a guest (escape hatch for unreadable storage). */
  resetSavedSession: () => Promise<void>;
  clearError: () => void;
  clearSessionNotice: () => void;
}

const SIGNED_OUT = {
  isAuthenticated: false,
  username: null,
  role: null,
  isOffline: false,
  storageUnavailable: false,
} as const;

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isBootstrapping: true,
  username: null,
  role: null,
  isOffline: false,
  storageUnavailable: false,
  error: null,
  sessionNotice: null,

  login: async (credentials) => {
    set({ error: null, sessionNotice: null });
    try {
      const res = await authApi.login(credentials);
      await storage.setToken(res.accessToken);
      await storage.setTokenExpiry(computeExpiryMs(res.expiresIn));
      await storage.setUserData({ username: res.username, role: res.role });

      set({
        isAuthenticated: true,
        username: res.username,
        role: res.role,
        isOffline: false,
        error: null,
        sessionNotice: null,
      });
      return res;
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Login failed');
      set({ error: msg });
      throw new Error(msg);
    }
  },

  register: async (data) => {
    set({ error: null });
    try {
      await authApi.register(data);
      set({ error: null });
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Registration failed');
      set({ error: msg });
      throw new Error(msg);
    }
  },

  logout: async () => {
    // Revoke the bearer token server-side first (best effort: a network
    // failure, timeout or an already-expired token must never block sign-out).
    try {
      await authApi.logout();
    } catch {
      // ignored — local cleanup below is authoritative
    }

    let cleanupError: unknown = null;
    try {
      await storage.clearSession();
    } catch (error) {
      cleanupError = error;
    }

    const cleanupMessage = cleanupError
      ? `Sign-out could not remove saved credentials from this device. ${
          cleanupError instanceof Error && cleanupError.message
            ? cleanupError.message
            : 'Secure sign-out failed. Please try again.'
        }`
      : null;

    // Always drop in-memory auth state and cached data, even when the
    // Keychain/Keystore deletion failed, so the UI never stays signed in. A
    // failed cleanup is surfaced app-wide (the calling screen unmounts as soon
    // as the state flips) because the saved token could restore the session on
    // the next launch.
    queryClient.clear();
    set({ ...SIGNED_OUT, error: null, sessionNotice: cleanupMessage });

    if (cleanupMessage) {
      throw new Error(cleanupMessage);
    }
  },

  checkAuth: async () => {
    set({ isBootstrapping: true });
    let token: string | null;
    try {
      token = await storage.getToken();
    } catch {
      set({
        isBootstrapping: false,
        isOffline: true,
        storageUnavailable: true,
        error: 'Secure credential storage is unavailable. Please try again.',
      });
      return;
    }
    set({ storageUnavailable: false });
    if (!token) {
      set({ ...SIGNED_OUT, isBootstrapping: false, error: null });
      return;
    }

    // Drop a token that is already past its stored expiry without a round
    // trip, and tell the user why they are signed out.
    if (isTokenExpired(await storage.getTokenExpiry())) {
      try {
        await storage.clearSession();
      } catch {
        // in-memory state is cleared below regardless
      }
      queryClient.clear();
      set({
        ...SIGNED_OUT,
        isBootstrapping: false,
        error: null,
        sessionNotice: SESSION_EXPIRED_MESSAGE,
      });
      return;
    }

    try {
      const res = await authApi.me();
      if (res.username && res.role) {
        // Server confirmed identity — fully authenticated
        await storage.setUserData({ username: res.username, role: res.role });

        set({
          isAuthenticated: true,
          isBootstrapping: false,
          username: res.username,
          role: res.role,
          isOffline: false,
          error: null,
        });
        return;
      }
    } catch (error: unknown) {
      const status = getHttpStatus(error);
      if (status !== 401 && status !== 403) {
        // A timeout/offline/DNS failure does not prove the bearer token is
        // invalid. Preserve it and let the user retry when connectivity returns.
        set({
          isBootstrapping: false,
          isOffline: true,
          error: 'Could not reach the server. Check your connection and retry.',
        });
        return;
      }
    }

    // Only a definitive authentication failure clears native credentials.
    try {
      await storage.clearSession();
    } catch {
      // in-memory state is cleared below regardless
    }
    queryClient.clear();
    set({
      ...SIGNED_OUT,
      isBootstrapping: false,
      error: null,
      sessionNotice: SESSION_EXPIRED_MESSAGE,
    });
  },

  resetSavedSession: async () => {
    try {
      await storage.clearSession();
    } catch {
      // the in-memory state below is cleared regardless
    }
    queryClient.clear();
    set({ ...SIGNED_OUT, isBootstrapping: false, error: null, sessionNotice: null });
  },

  clearError: () => set({ error: null }),
  clearSessionNotice: () => set({ sessionNotice: null }),
}));

// The API client ends the session itself (expired token before a request, 401
// from a protected endpoint); mirror that into the store. Only a user who was
// signed in is told their session ended.
setSessionEndedHandler(() =>
  useAuthStore.setState((state) => ({
    ...SIGNED_OUT,
    error: null,
    sessionNotice: state.isAuthenticated ? SESSION_EXPIRED_MESSAGE : state.sessionNotice,
  })),
);
