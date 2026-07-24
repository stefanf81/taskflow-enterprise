import { create } from 'zustand';
import { storage } from '../utils/storage';
import { authApi } from '../api/auth';
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
      if (res.token) {
        await storage.setToken(res.token);
      }
      await storage.setUserData({ username: res.username, role: res.role });

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
      // Fallback check stored user data if me fails offline
      const stored = await storage.getUserData<{ username: string; role: string }>();
      const token = await storage.getToken();
      if (token && stored) {
        set({
          isAuthenticated: true,
          isLoading: false,
          username: stored.username,
          role: stored.role as AuthState['role'],
          error: null,
        });
        return;
      }
    }

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
