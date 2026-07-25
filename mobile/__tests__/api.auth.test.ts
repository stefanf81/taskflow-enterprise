import { authApi } from '../src/api/auth';
import { apiClient } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

const mockedPost = apiClient.post as jest.Mock;
const mockedGet = apiClient.get as jest.Mock;

describe('authApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('sends POST with credentials and returns LoginResponse', async () => {
      const mockResponse = { username: 'admin', role: 'ROLE_ADMIN' };
      mockedPost.mockResolvedValueOnce({ data: mockResponse });

      const result = await authApi.login({ username: 'admin', password: 'admin-password' });

      expect(mockedPost).toHaveBeenCalledWith('/api/v1/auth/login', {
        username: 'admin',
        password: 'admin-password',
      });
      expect(result).toEqual(mockResponse);
    });

    it('propagates error on failure', async () => {
      mockedPost.mockRejectedValueOnce(new Error('Network Error'));
      await expect(authApi.login({ username: 'admin', password: 'wrong' })).rejects.toThrow();
    });
  });

  describe('me', () => {
    it('sends GET and returns current user', async () => {
      const mockResponse = { username: 'admin', role: 'ROLE_ADMIN' };
      mockedGet.mockResolvedValueOnce({ data: mockResponse });

      const result = await authApi.me();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/auth/me');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('register', () => {
    it('sends POST with registration data', async () => {
      mockedPost.mockResolvedValueOnce({});
      const registerData = {
        fullName: 'Jane Smith',
        email: 'jane@example.com',
        password: 'password123',
        phone: '+1-555-0000',
      };

      await authApi.register(registerData);
      expect(mockedPost).toHaveBeenCalledWith('/api/v1/auth/register', registerData);
    });
  });

  describe('logout', () => {
    it('sends POST to logout endpoint', async () => {
      mockedPost.mockResolvedValueOnce({});
      await authApi.logout();
      expect(mockedPost).toHaveBeenCalledWith('/api/v1/auth/logout');
    });
  });

  describe('fetchCsrfToken', () => {
    it('sends GET and returns token string', async () => {
      mockedGet.mockResolvedValueOnce({ data: { token: 'csrf-token-xyz' } });
      const result = await authApi.fetchCsrfToken();
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/auth/csrf');
      expect(result).toBe('csrf-token-xyz');
    });
  });
});
