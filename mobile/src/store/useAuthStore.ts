import { create } from 'zustand';
import { storage } from '../utils/storage';
import { authApi } from '../api/auth';
import { setCsrfToken } from '../api/client';
import { LoginRequest, LoginResponse, RegisterRequest } from '../types/api';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER' | null;
  error: string | null;

  login: (credentials: LoginRequest) => Promise<LoginResponse>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  username: null,
  role: null,
  error: null,

  login: async (credentials) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.login(credentials);
      // The backend issues the JWT via an HttpOnly, SameSite=Strict cookie
      // (LoginResponse only carries username + role — no token in the body).
      // Mobile auth therefore rides on the cookie via withCredentials; the JWT
      // is never held in JavaScript, mirroring the XSS-safe web flow.
      await storage.setUserData({ username: res.username, role: res.role });

      // Re-fetch the CSRF token — the session cookie may have changed
      // after authentication.
      try {
        const newToken = await authApi.fetchCsrfToken();
        setCsrfToken(newToken);
      } catch {
        // Non-fatal; the interceptor will lazily fetch it.
      }

      set({
        isAuthenticated: true,
        isLoading: false,
        username: res.username,
        role: res.role,
        error: null,
      });
      return res;
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : err instanceof Error
            ? err.message
            : 'Login failed';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  register: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await authApi.register(data);
      set({ isLoading: false, error: null });
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : err instanceof Error
            ? err.message
            : 'Registration failed';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout API failures
    } finally {
      await storage.removeToken();
      await storage.removeUserData();
      setCsrfToken(null);
      set({
        isAuthenticated: false,
        isLoading: false,
        username: null,
        role: null,
        error: null,
      });
    }
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const res = await authApi.me();
      if (res.username && res.role) {
        // Server confirmed identity — fully authenticated
        await storage.setUserData({ username: res.username, role: res.role });

        // Eagerly pre-fetch the CSRF token so the first state-changing request
        // doesn't have to wait for a separate /auth/csrf round-trip (the
        // request interceptor would otherwise lazy-fetch it and could fail
        // silently, leaving subsequent POSTs with a stale/missing token).
        try {
          const csrf = await authApi.fetchCsrfToken();
          setCsrfToken(csrf);
        } catch {
          // Non-fatal; the interceptor will lazily fetch it.
        }

        set({
          isAuthenticated: true,
          isLoading: false,
          username: res.username,
          role: res.role,
          error: null,
        });
        return;
      }
    } catch {
      // Server unreachable — do NOT trust locally cached role.
      // Clear auth state so the user must re-authenticate against the server.
    }

    // Either /me returned no data, or the request failed.
    // Wipe local credentials to force a fresh login.
    await storage.removeToken();
    await storage.removeUserData();
    set({
      isAuthenticated: false,
      isLoading: false,
      username: null,
      role: null,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
