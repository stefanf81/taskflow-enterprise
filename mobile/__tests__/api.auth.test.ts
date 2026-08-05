import { authApi } from '../src/api/auth';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';

describe('authApi', () => {
  it('uses the native bearer login endpoint', async () => {
    await expect(authApi.login({ username: 'admin', password: 'admin-password' })).resolves.toEqual({
      accessToken: 'mobile-jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
      username: 'admin',
      role: 'ROLE_ADMIN',
    });
  });

  it('propagates login errors', async () => {
    server.use(http.post('*/api/v1/auth/mobile/login', () => HttpResponse.error()));

    await expect(authApi.login({ username: 'admin', password: 'wrong' })).rejects.toThrow();
  });

  it('returns the server-confirmed current user', async () => {
    await expect(authApi.me()).resolves.toEqual({ username: 'admin', role: 'ROLE_ADMIN' });
  });

  it('registers without requiring a cookie session', async () => {
    const registerData = {
      fullName: 'Jane Smith',
      email: 'jane@example.com',
      password: 'password123',
      phone: '+1-555-0000',
    };
    await expect(authApi.register(registerData)).resolves.toBeUndefined();
  });
});
