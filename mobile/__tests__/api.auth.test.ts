import { authApi } from '../src/core/auth/auth';
import { ApiContractError } from '../src/api/contracts';
import { storage } from '../src/utils/storage';
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

  it('rejects a malformed mobile login response with a contract error', async () => {
    server.use(
      http.post('*/api/v1/auth/mobile/login', () => HttpResponse.json({ username: 'admin' })),
    );

    const promise = authApi.login({ username: 'admin', password: 'admin-password' });
    await expect(promise).rejects.toBeInstanceOf(ApiContractError);
    await expect(
      authApi.login({ username: 'admin', password: 'admin-password' }),
    ).rejects.toThrow(/Contract violation for POST \/api\/v1\/auth\/mobile\/login/);
  });

  it('rejects an unknown role from /me before it can drive navigation', async () => {
    server.use(
      http.get('*/api/v1/auth/me', () =>
        HttpResponse.json({ username: 'admin', role: 'SUPERUSER' }),
      ),
    );

    await expect(authApi.me()).rejects.toThrow(/Contract violation for GET \/api\/v1\/auth\/me/);
  });

  it('rejects a malformed register response', async () => {
    server.use(
      http.post('*/api/v1/auth/register', () => new HttpResponse(null, { status: 201 })),
    );

    await expect(
      authApi.register({
        fullName: 'Jane Smith',
        email: 'jane@example.com',
        password: 'password123',
        phone: '+1-555-0000',
      }),
    ).rejects.toThrow(/Contract violation for POST \/api\/v1\/auth\/register/);
  });

  it('revokes the bearer token via POST /auth/logout', async () => {
    let called = false;
    server.use(
      http.post('*/api/v1/auth/logout', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(authApi.logout()).resolves.toBeUndefined();
    expect(called).toBe(true);
  });

  it('still signs out server-side when the Keychain cannot read the refresh token', async () => {
    jest
      .spyOn(storage, 'getRefreshToken')
      .mockRejectedValueOnce(new Error('Secure credential storage is unavailable.'));
    let body: string | undefined;
    server.use(
      http.post('*/api/v1/auth/logout', async ({ request }) => {
        body = await request.text();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(authApi.logout()).resolves.toBeUndefined();
    // Without the refresh token; a valid bearer token alone revokes its refresh session.
    expect(JSON.parse(body || 'null')).toBeNull();
  });

  it('surfaces a failing logout call so callers can ignore it explicitly', async () => {
    server.use(http.post('*/api/v1/auth/logout', () => HttpResponse.error()));
    await expect(authApi.logout()).rejects.toThrow();
  });

  it('sends captured credentials directly without reading a newer session from storage', async () => {
    await storage.startSession({
      token: 'newer-session-jwt',
      expiresAt: Date.now() + 60_000,
      refreshToken: 'newer-refresh',
    });
    let authHeader: string | null = null;
    let body: unknown = null;
    server.use(
      http.post('*/api/v1/auth/logout', async ({ request }) => {
        authHeader = request.headers.get('authorization');
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(
      authApi.logout({ accessToken: 'captured-old-jwt', refreshToken: 'captured-old-refresh' }),
    ).resolves.toBeUndefined();
    expect(authHeader).toBe('Bearer captured-old-jwt');
    expect(body).toEqual({ refreshToken: 'captured-old-refresh' });
  });
});
