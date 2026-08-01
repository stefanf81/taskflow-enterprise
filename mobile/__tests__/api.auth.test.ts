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
  beforeEach(() => jest.clearAllMocks());

  it('uses the native bearer login endpoint', async () => {
    const mockResponse = {
      accessToken: 'mobile-jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
      username: 'admin',
      role: 'ROLE_ADMIN',
    };
    mockedPost.mockResolvedValueOnce({ data: mockResponse });

    const result = await authApi.login({ username: 'admin', password: 'admin-password' });

    expect(mockedPost).toHaveBeenCalledWith('/api/v1/auth/mobile/login', {
      username: 'admin',
      password: 'admin-password',
    });
    expect(result).toEqual(mockResponse);
  });

  it('propagates login errors', async () => {
    mockedPost.mockRejectedValueOnce(new Error('Network Error'));
    await expect(authApi.login({ username: 'admin', password: 'wrong' })).rejects.toThrow();
  });

  it('returns the server-confirmed current user', async () => {
    const mockResponse = { username: 'admin', role: 'ROLE_ADMIN' };
    mockedGet.mockResolvedValueOnce({ data: mockResponse });

    await expect(authApi.me()).resolves.toEqual(mockResponse);
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/auth/me');
  });

  it('registers without requiring a cookie session', async () => {
    const registerData = {
      fullName: 'Jane Smith',
      email: 'jane@example.com',
      password: 'password123',
      phone: '+1-555-0000',
    };
    mockedPost.mockResolvedValueOnce({});

    await authApi.register(registerData);
    expect(mockedPost).toHaveBeenCalledWith('/api/v1/auth/register', registerData);
  });
});
