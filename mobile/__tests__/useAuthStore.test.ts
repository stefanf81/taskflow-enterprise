import { useAuthStore } from '../src/store/useAuthStore';
import { authApi } from '../src/api/auth';
import { storage } from '../src/utils/storage';
import { setCsrfToken } from '../src/api/client';

// Mock dependencies
jest.mock('../src/api/auth', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    fetchCsrfToken: jest.fn(),
  },
}));

jest.mock('../src/utils/storage', () => ({
  storage: {
    setToken: jest.fn(),
    getToken: jest.fn(),
    removeToken: jest.fn(),
    setUserData: jest.fn(),
    getUserData: jest.fn(),
    removeUserData: jest.fn(),
  },
}));

jest.mock('../src/api/client', () => ({
  setCsrfToken: jest.fn(),
}));

describe('useAuthStore (enhanced)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      username: null,
      role: null,
      error: null,
    });
    jest.clearAllMocks();
  });

  // ============ Initial State ============
  it('initializes with logged out state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.role).toBeNull();
    expect(state.username).toBeNull();
    expect(state.error).toBeNull();
  });

  // ============ Login ============
  it('handles login successfully for admin', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      username: 'admin',
      role: 'ROLE_ADMIN',
    });
    (authApi.fetchCsrfToken as jest.Mock).mockResolvedValueOnce('new-csrf');

    await useAuthStore.getState().login({ username: 'admin', password: 'admin-password' });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.username).toBe('admin');
    expect(state.role).toBe('ROLE_ADMIN');
    expect(state.error).toBeNull();
    // The JWT is HttpOnly-cookie-based — it must never be stored client-side.
    expect(storage.setToken).not.toHaveBeenCalled();
    expect(storage.setUserData).toHaveBeenCalledWith({ username: 'admin', role: 'ROLE_ADMIN' });
    expect(setCsrfToken).toHaveBeenCalledWith('new-csrf');
  });

  it('handles login for customer role', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      username: 'customer1',
      role: 'ROLE_CUSTOMER',
    });
    (authApi.fetchCsrfToken as jest.Mock).mockResolvedValueOnce('csrf-2');

    await useAuthStore.getState().login({ username: 'customer1', password: 'password' });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.role).toBe('ROLE_CUSTOMER');
    expect(state.username).toBe('customer1');
  });

  it('never persists a JWT to client storage (cookie-only auth)', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({
      username: 'admin',
      role: 'ROLE_ADMIN',
    });

    await useAuthStore.getState().login({ username: 'admin', password: 'password' });

    expect(storage.setToken).not.toHaveBeenCalled();
  });

  it('sets error on login failure with error message from response', async () => {
    (authApi.login as jest.Mock).mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    });

    try {
      await useAuthStore.getState().login({ username: 'admin', password: 'wrong' });
    } catch {
      // expected
    }

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBe('Invalid credentials');
  });

  it('sets generic error on login failure without details', async () => {
    (authApi.login as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));

    try {
      await useAuthStore.getState().login({ username: 'admin', password: 'wrong' });
    } catch {
      // expected
    }

    const state = useAuthStore.getState();
    expect(state.error).toBe('Network Error');
  });

  // ============ Register ============
  it('handles registration successfully', async () => {
    (authApi.register as jest.Mock).mockResolvedValueOnce(undefined);

    await useAuthStore.getState().register({
      fullName: 'Jane',
      email: 'jane@example.com',
      password: 'password',
      phone: '+1',
    });

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('sets error on registration failure', async () => {
    (authApi.register as jest.Mock).mockRejectedValueOnce(new Error('Email taken'));

    try {
      await useAuthStore.getState().register({
        fullName: 'Jane',
        email: 'taken@example.com',
        password: 'password',
        phone: '+1',
      });
    } catch {
      // expected
    }

    const state = useAuthStore.getState();
    expect(state.error).toBe('Email taken');
  });

  // ============ Logout ============
  it('handles logout successfully', async () => {
    (authApi.logout as jest.Mock).mockResolvedValueOnce(undefined);

    useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.username).toBeNull();
    expect(state.role).toBeNull();
    expect(storage.removeToken).toHaveBeenCalled();
    expect(storage.removeUserData).toHaveBeenCalled();
    expect(setCsrfToken).toHaveBeenCalledWith(null);
  });

  it('clears state even when logout API fails', async () => {
    (authApi.logout as jest.Mock).mockRejectedValueOnce(new Error('Server down'));

    useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.username).toBeNull();
  });

  // ============ Check Auth ============
  it('restores authenticated state when /me succeeds', async () => {
    (authApi.me as jest.Mock).mockResolvedValueOnce({
      username: 'admin',
      role: 'ROLE_ADMIN',
    });
    // checkAuth eagerly pre-fetches the CSRF token on a successful restore.
    (authApi.fetchCsrfToken as jest.Mock).mockResolvedValueOnce('csrf-restored');

    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.username).toBe('admin');
    expect(state.role).toBe('ROLE_ADMIN');
    expect(state.isLoading).toBe(false);
    expect(setCsrfToken).toHaveBeenCalledWith('csrf-restored');
  });

  it('clears auth state when /me fails', async () => {
    (authApi.me as jest.Mock).mockRejectedValueOnce(new Error('Not authenticated'));

    useAuthStore.setState({ isAuthenticated: true, isLoading: true, username: 'admin', role: 'ROLE_ADMIN' });
    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.username).toBeNull();
    expect(state.role).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  // ============ Clear Error ============
  it('clears error state', () => {
    useAuthStore.setState({ error: 'Some error' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});
