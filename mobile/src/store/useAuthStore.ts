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
      await storage.setToken(res.accessToken);
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
    // Bearer JWTs are stateless; logout removes the native credential. Server
    // revocation can be added later with a jti deny-list if required.
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

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const token = await storage.getToken();
      if (!token) {
        throw new Error('No mobile access token');
      }
      const res = await authApi.me();
      if (res.username && res.role) {
        // Server confirmed identity — fully authenticated
        await storage.setUserData({ username: res.username, role: res.role });

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
