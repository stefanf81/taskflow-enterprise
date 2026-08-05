import { create } from 'zustand';
import { storage } from '../utils/storage';
import { authApi } from '../api/auth';
import { LoginRequest, LoginResponse, RegisterRequest } from '../types/api';
import { queryClient } from '../query/queryClient';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER' | null;
  isOffline: boolean;
  error: string | null;

  login: (credentials: LoginRequest) => Promise<LoginResponse>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  username: null,
  role: null,
  isOffline: false,
  error: null,

  login: async (credentials) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.login(credentials);
      await storage.setToken(res.accessToken);
      await storage.setUserData({ username: res.username, role: res.role });

      set({
        isAuthenticated: true,
        isLoading: false,
        username: res.username,
        role: res.role,
        isOffline: false,
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
    // Bearer JWTs are stateless; logout removes the native credential. Server
    // revocation can be added later with a jti deny-list if required.
    try {
      await storage.removeToken();
      await storage.removeUserData();
      queryClient.clear();
      set({
        isAuthenticated: false,
        isLoading: false,
        username: null,
        role: null,
        isOffline: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Secure sign-out failed. Please try again.';
      set({ isLoading: false, error: message });
      throw new Error(message);
    }
  },

  checkAuth: async () => {
    set({ isLoading: true });
    let token: string | null;
    try {
      token = await storage.getToken();
    } catch {
      set({
        isLoading: false,
        isOffline: true,
        error: 'Secure credential storage is unavailable. Please try again.',
      });
      return;
    }
    if (!token) {
      set({
        isAuthenticated: false,
        isLoading: false,
        username: null,
        role: null,
        isOffline: false,
        error: null,
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
          isLoading: false,
          username: res.username,
          role: res.role,
          isOffline: false,
          error: null,
        });
        return;
      }
    } catch (error: unknown) {
      const status =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      if (status !== 401 && status !== 403) {
        // A timeout/offline/DNS failure does not prove the bearer token is
        // invalid. Preserve it and let the user retry when connectivity returns.
        set({
          isLoading: false,
          isOffline: true,
          error: 'Could not reach the server. Check your connection and retry.',
        });
        return;
      }
    }

    // Only a definitive authentication failure clears native credentials.
    await storage.removeToken();
    await storage.removeUserData();
    queryClient.clear();
    set({
      isAuthenticated: false,
      isLoading: false,
      username: null,
      role: null,
      isOffline: false,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
