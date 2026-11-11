import { create } from 'zustand';
import { storage } from '../../utils/storage';
import { authApi } from './auth';
import { renewSessionWithIdentity, setSessionEndedHandler } from '../../api/client';
import { LoginRequest, LoginResponse, RegisterRequest } from '../../types/api';
import { queryClient } from '../../query/queryClient';
import { getApiErrorMessage, getHttpStatus } from '../../utils/errors';
import {
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  computeExpiryMs,
  isTokenExpired,
} from '../../utils/session';
import { ApiContractError } from '../../api/contracts';

/** Shown when /me answered with an account this build cannot read (e.g. a role it does not know). */
export const ACCOUNT_UNREADABLE_MESSAGE =
  'This version of the app could not load your account. Please sign in again, or update the app if this keeps happening.';

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

/** The saved sign-in could not be read: nothing is erased, the user may retry or reset. */
const STORAGE_UNAVAILABLE = {
  isBootstrapping: false,
  isOffline: true,
  storageUnavailable: true,
  error: 'Secure credential storage is unavailable. Please try again.',
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
      await storage.startSession({
        token: res.accessToken,
        expiresAt: computeExpiryMs(res.expiresIn),
        refreshToken: res.refreshToken,
      });

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
      set(STORAGE_UNAVAILABLE);
      return;
    }
    set({ storageUnavailable: false });
    if (!token) {
      set({ ...SIGNED_OUT, isBootstrapping: false, error: null });
      return;
    }

    // Drop a token that is already past its stored expiry without a round
    // trip when no refresh token is stored, and tell the user why they are signed out.
    // An unreadable refresh token proves nothing: keep the session and offer a retry.
    let tokenExpired: boolean;
    let expiredForGood: boolean;
    try {
      tokenExpired = isTokenExpired(await storage.getTokenExpiry());
      expiredForGood = tokenExpired && !(await storage.getRefreshToken());
    } catch {
      set(STORAGE_UNAVAILABLE);
      return;
    }
    if (expiredForGood) {
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

    let unreadableAccount = false;
    try {
      // The access token lives an hour and the refresh session a month, so a returning user
      // usually launches with an expired token. Renewing it answers who the account is as well
      // (the refresh response carries the username and role), so /me is only asked when the
      // stored token is still valid. Both paths parse the same shared role schema.
      const res = tokenExpired ? await renewSessionWithIdentity() : await authApi.me();
      if (res.username && res.role) {
        // Server confirmed identity — fully authenticated
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
      // A missing refresh token rejects the session like a 401 would.
      const status = error instanceof SessionExpiredError ? 401 : getHttpStatus(error);
      // The server answered, but with a body the shared contract rejects (a new role, a renamed
      // field). That is not "offline": every Retry gets the same answer, so the user would be
      // stuck on the Retry screen for good. Sign out instead, like the unknown-role guard in
      // RootNavigator, so the app stays usable as a guest.
      unreadableAccount = error instanceof ApiContractError;
      if (!unreadableAccount && status !== 401 && status !== 403) {
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
      sessionNotice: unreadableAccount ? ACCOUNT_UNREADABLE_MESSAGE : SESSION_EXPIRED_MESSAGE,
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
