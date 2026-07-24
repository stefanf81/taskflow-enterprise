import { useAuthStore } from '../src/store/useAuthStore';

// Mock authApi
jest.mock('../src/api/auth', () => ({
  authApi: {
    login: jest.fn().mockResolvedValue({ username: 'admin', role: 'ROLE_ADMIN', token: 'mock-token' }),
    register: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    me: jest.fn().mockResolvedValue({ username: 'admin', role: 'ROLE_ADMIN' }),
  },
}));

describe('Auth Store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      username: null,
      role: null,
      error: null,
    });
  });

  it('initializes with logged out state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.role).toBeNull();
  });

  it('handles login successfully', async () => {
    await useAuthStore.getState().login({ username: 'admin', password: 'admin-password' });
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.username).toBe('admin');
    expect(state.role).toBe('ROLE_ADMIN');
  });

  it('handles logout successfully', async () => {
    useAuthStore.setState({ isAuthenticated: true, username: 'admin', role: 'ROLE_ADMIN' });
    await useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.username).toBeNull();
  });
});
