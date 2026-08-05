import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('*/api/v1/auth/mobile/login', () =>
    HttpResponse.json({
      accessToken: 'mobile-jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
      username: 'admin',
      role: 'ROLE_ADMIN',
    }),
  ),
  http.get('*/api/v1/auth/me', () =>
    HttpResponse.json({ username: 'admin', role: 'ROLE_ADMIN' }),
  ),
  http.post(
    '*/api/v1/auth/register',
    () => new HttpResponse(null, { status: 201 }),
  ),
];
