import { useAuthStore } from '../src/store/useAuthStore';
import { authApi } from '../src/api/auth';
import { storage } from '../src/utils/storage';
import { queryClient } from '../src/query/queryClient';

jest.mock('../src/api/auth', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    me: jest.fn(),
  },
}));

jest.mock('../src/utils/storage', () => ({
  storage: {
    setToken: jest.fn(),
    getToken: jest.fn(),
    removeToken: jest.fn(),
    setUserData: jest.fn(),
    removeUserData: jest.fn(),
  },
}));

const mobileLoginResponse = (username: string, role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER') => ({
  accessToken: `${username}-jwt`,
  tokenType: 'Bearer' as const,
  expiresIn: 3600,
  username,
  role,
});

describe('useAuthStore', () => {
  beforeEach(() => {
    queryClient.clear();
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      username: null,
      role: null,
      isOffline: false,
      error: null,
    });
    jest.clearAllMocks();
  });

  it('starts logged out', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.role).toBeNull();
    expect(state.username).toBeNull();
  });

  it('stores the mobile bearer token after admin login', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce(mobileLoginResponse('admin', 'ROLE_ADMIN'));

    await useAuthStore.getState().login({ username: 'admin', password: 'admin-password' });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.username).toBe('admin');
    expect(state.role).toBe('ROLE_ADMIN');
    expect(storage.setToken).toHaveBeenCalledWith('admin-jwt');
    expect(storage.setUserData).toHaveBeenCalledWith({ username: 'admin', role: 'ROLE_ADMIN' });
  });

  it('stores a customer bearer token after customer login', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce(
      mobileLoginResponse('customer1', 'ROLE_CUSTOMER'),
    );

    await useAuthStore.getState().login({ username: 'customer1', password: 'password' });

    expect(useAuthStore.getState().role).toBe('ROLE_CUSTOMER');
    expect(storage.setToken).toHaveBeenCalledWith('customer1-jwt');
  });

  it('surfaces login errors', async () => {
    (authApi.login as jest.Mock).mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    });

    await expect(
      useAuthStore.getState().login({ username: 'admin', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');
    expect(useAuthStore.getState().error).toBe('Invalid credentials');
  });

  it('handles registration', async () => {
    (authApi.register as jest.Mock).mockResolvedValueOnce(undefined);

    await useAuthStore.getState().register({
      fullName: 'Jane',
      email: 'jane@example.com',
      password: 'password',
      phone: '+1',
    });

    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('logs out locally by deleting the bearer token', async () => {
    useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
    queryClient.setQueryData(['customerAppointments', 0, 10], { content: ['private appointment'] });

    await useAuthStore.getState().logout();

    expect(storage.removeToken).toHaveBeenCalledTimes(1);
    expect(storage.removeUserData).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().username).toBeNull();
    expect(queryClient.getQueryData(['customerAppointments', 0, 10])).toBeUndefined();
  });

  it('restores state only when a stored token is confirmed by /me', async () => {
    (storage.getToken as jest.Mock).mockResolvedValueOnce('stored-jwt');
    (authApi.me as jest.Mock).mockResolvedValueOnce({
      username: 'admin',
      role: 'ROLE_ADMIN',
    });

    await useAuthStore.getState().checkAuth();

    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(storage.setUserData).toHaveBeenCalledWith({ username: 'admin', role: 'ROLE_ADMIN' });
  });

  it('does not call /me without a stored bearer token', async () => {
    (storage.getToken as jest.Mock).mockResolvedValueOnce(null);

    await useAuthStore.getState().checkAuth();

    expect(authApi.me).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('clears state when /me definitively rejects the stored token', async () => {
    (storage.getToken as jest.Mock).mockResolvedValueOnce('expired-jwt');
    (authApi.me as jest.Mock).mockRejectedValueOnce({ response: { status: 401 } });
    useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });

    await useAuthStore.getState().checkAuth();

    expect(storage.removeToken).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().role).toBeNull();
  });

  it('preserves credentials and exposes retry state when /me is offline', async () => {
    (storage.getToken as jest.Mock).mockResolvedValueOnce('stored-jwt');
    (authApi.me as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
    useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });

    await useAuthStore.getState().checkAuth();

    expect(storage.removeToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isOffline).toBe(true);
  });

  it('clears an error', () => {
    useAuthStore.setState({ error: 'Some error' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});
