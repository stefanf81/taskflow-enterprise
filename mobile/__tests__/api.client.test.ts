let mockGetToken: jest.Mock;
let mockGetTokenExpiry: jest.Mock;
let mockClearSession: jest.Mock;
let mockGetRefreshToken: jest.Mock;
let mockRotateSession: jest.Mock;
// The session epoch: like the real storage, clearSession ends it at once.
let mockEpoch = 0;
const mockSessionEnded = jest.fn();

jest.mock('../src/utils/storage', () => {
  const getToken = jest.fn();
  const getTokenExpiry = jest.fn();
  const clearSession = jest.fn();
  const getRefreshToken = jest.fn();
  const rotateSession = jest.fn();
  mockGetToken = getToken;
  mockGetTokenExpiry = getTokenExpiry;
  mockClearSession = clearSession;
  mockGetRefreshToken = getRefreshToken;
  mockRotateSession = rotateSession;
  return {
    storage: {
      getToken: (...args: unknown[]) => getToken(...args),
      getTokenExpiry: (...args: unknown[]) => getTokenExpiry(...args),
      clearSession: (...args: unknown[]) => {
        mockEpoch++;
        return clearSession(...args);
      },
      getRefreshToken: (...args: unknown[]) => getRefreshToken(...args),
      rotateSession: (...args: unknown[]) => rotateSession(...args),
      getSessionEpoch: () => mockEpoch,
    },
  };
});

let capturedCreateConfig: Record<string, unknown>;
let mockRequestUse: jest.Mock;
let mockResponseUse: jest.Mock;
let mockPost: jest.Mock;
let mockRequest: jest.Mock;

jest.mock('axios', () => {
  const requestUse = jest.fn();
  const responseUse = jest.fn();
  const post = jest.fn();
  const request = jest.fn();
  mockRequestUse = requestUse;
  mockResponseUse = responseUse;
  mockPost = post;
  mockRequest = request;

  const defaults: Record<string, unknown> = {};
  const instance: Record<string, unknown> = {
    defaults,
    interceptors: {
      request: { use: requestUse },
      response: { use: responseUse },
    },
    post: (...args: unknown[]) => post(...args),
    request: (...args: unknown[]) => request(...args),
  };

  return {
    create: (config: Record<string, unknown>) => {
      capturedCreateConfig = config;
      Object.assign(defaults, config);
      return instance;
    },
  };
});

import { renewSession, setSessionEndedHandler } from '../src/api/client';
import { queryClient } from '../src/query/queryClient';
import { SessionChangedError, SessionExpiredError } from '../src/utils/session';

describe('mobile api client', () => {
  let requestHandler: (config: any) => Promise<any>;
  let requestErrorHandler: (error: any) => Promise<any>;
  let responseErrorHandler: (error: any) => Promise<any>;

  beforeAll(() => {
    requestHandler = mockRequestUse.mock.calls[0][0];
    requestErrorHandler = mockRequestUse.mock.calls[0][1];
    responseErrorHandler = mockResponseUse.mock.calls[0][1];
  });

  const REFRESH = 'r'.repeat(43);
  const ROTATED = 's'.repeat(43);
  const renewed = {
    data: {
      accessToken: 'renewed-jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
      username: 'customer@example.com',
      role: 'ROLE_CUSTOMER',
      refreshToken: ROTATED,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setSessionEndedHandler(() => mockSessionEnded());
    mockGetTokenExpiry.mockResolvedValue(null);
    mockClearSession.mockResolvedValue(undefined);
    mockGetRefreshToken.mockResolvedValue(null);
    mockEpoch = 0;
    // Like the real storage: a renewal's credentials are stored only for its own session.
    mockRotateSession.mockImplementation(async (epoch: number) => epoch === mockEpoch);
  });

  const expired = () => {
    mockGetToken.mockResolvedValue('expired-jwt');
    mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
  };

  it('does not enable native cookie credentials', () => {
    expect(capturedCreateConfig.withCredentials).toBe(false);
    expect(capturedCreateConfig.timeout).toBe(10000);
  });

  describe('request interceptor', () => {
    const reqConfig = (url: string, method = 'get') => ({
      headers: {} as Record<string, string | undefined>,
      url,
      method,
    });

    it('injects a SecureStore bearer token on protected requests', async () => {
      mockGetToken.mockResolvedValueOnce('test-jwt');
      const config = reqConfig('/api/v1/appointments');

      await expect(requestHandler(config)).resolves.toBe(config);
      expect(config.headers.Authorization).toBe('Bearer test-jwt');
    });

    it('omits Authorization when no token is stored', async () => {
      mockGetToken.mockResolvedValueOnce(null);
      const config = reqConfig('/api/v1/appointments');

      await requestHandler(config);
      expect(config.headers.Authorization).toBeUndefined();
    });

    it('never attaches the token to public endpoints (and does not even read it)', async () => {
      mockGetToken.mockResolvedValue('valid-jwt');
      const publicCalls: Array<[string, string]> = [
        ['post', '/api/v1/auth/mobile/login'],
        ['post', '/api/v1/auth/login'],
        ['post', '/api/v1/auth/register'],
        ['post', '/api/v1/appointments'],
        ['get', '/api/v1/appointments/public/busy-slots'],
        ['get', '/api/v1/appointments/public/shop'],
        ['put', '/api/v1/appointments/public/cancel/123e4567-e89b-12d3-a456-426614174000'],
        ['get', '/api/v1/catalog'],
        ['get', '/api/v1/barbers'],
        ['get', '/api/v1/reviews/public/barber-ratings'],
        ['post', '/api/v1/reviews/public/123e4567-e89b-12d3-a456-426614174000'],
      ];
      for (const [method, url] of publicCalls) {
        const config = reqConfig(url, method);
        await requestHandler(config);
        expect(config.headers.Authorization).toBeUndefined();
      }
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('still authenticates protected look-alikes of public paths', async () => {
      mockGetToken.mockResolvedValue('valid-jwt');
      for (const [method, url] of [
        ['get', '/api/v1/appointments'],
        ['get', '/api/v1/barbers/admin'],
        ['get', '/api/v1/barbers/1/time-off'],
        ['delete', '/api/v1/appointments/5'],
        ['get', '/api/v1/auth/me'],
        ['post', '/api/v1/auth/logout'],
        ['get', '/api/v1/customer/appointments'],
        ['get', '/api/v1/notifications'],
      ]) {
        const config = reqConfig(url, method);
        await requestHandler(config);
        expect(config.headers.Authorization).toBe('Bearer valid-jwt');
      }
    });

    it('drops an expired token before it is sent and ends the session cleanly', async () => {
      mockGetToken.mockResolvedValue('expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
      queryClient.setQueryData(['customerAppointments', 0, 10], { content: ['private'] });
      const config = reqConfig('/api/v1/customer/appointments');

      await expect(requestHandler(config)).rejects.toBeInstanceOf(SessionExpiredError);

      expect(config.headers.Authorization).toBeUndefined();
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(['customerAppointments', 0, 10])).toBeUndefined();
      expect(mockSessionEnded).toHaveBeenCalledTimes(1);
    });

    it('treats a token inside the clock-skew margin as expired', async () => {
      mockGetToken.mockResolvedValue('almost-expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() + 2000);
      await expect(
        requestHandler(reqConfig('/api/v1/appointments')),
      ).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('keeps a token whose expiry is unknown', async () => {
      mockGetToken.mockResolvedValue('legacy-jwt');
      mockGetTokenExpiry.mockResolvedValue(null);
      const config = reqConfig('/api/v1/appointments');
      await requestHandler(config);
      expect(config.headers.Authorization).toBe('Bearer legacy-jwt');
    });

    it('lets logout go out unauthenticated when the token already expired', async () => {
      mockGetToken.mockResolvedValue('expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
      const config = reqConfig('/api/v1/auth/logout', 'post');

      await expect(requestHandler(config)).resolves.toBe(config);
      expect(config.headers.Authorization).toBeUndefined();
      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('still finishes the in-memory logout when secure deletion fails on expiry', async () => {
      mockGetToken.mockResolvedValue('expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
      mockClearSession.mockRejectedValueOnce(new Error('keychain'));

      await expect(
        requestHandler({ headers: {}, url: '/api/v1/appointments', method: 'get' }),
      ).rejects.toBeInstanceOf(SessionExpiredError);
      expect(mockSessionEnded).toHaveBeenCalled();
    });

    it('passes request errors through unchanged', async () => {
      const error = new Error('Config error');
      await expect(requestErrorHandler(error)).rejects.toBe(error);
    });

    it('renews an expired token with the stored refresh token instead of ending the session', async () => {
      expired();
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockResolvedValueOnce(renewed);
      const config = { headers: {} as Record<string, string>, url: '/api/v1/appointments', method: 'get' };

      await expect(requestHandler(config)).resolves.toBe(config);

      expect(mockPost).toHaveBeenCalledWith('/api/v1/auth/mobile/refresh', { refreshToken: REFRESH });
      expect(config.headers.Authorization).toBe('Bearer renewed-jwt');
      expect(mockRotateSession).toHaveBeenCalledWith(0, {
        token: 'renewed-jwt',
        expiresAt: expect.any(Number),
        refreshToken: ROTATED,
      });
      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('remembers the session a request was sent under', async () => {
      mockGetToken.mockResolvedValue('valid-jwt');
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' } as Record<string, unknown>;

      await requestHandler(config);
      expect(config.sessionEpoch).toBe(0);
    });

    it('never sends a request (or its replay) with the credentials of the session that replaced its own', async () => {
      mockGetToken.mockResolvedValue('next-user-jwt');
      const replay = {
        headers: {} as Record<string, string>,
        url: '/api/v1/customer/appointments',
        method: 'get',
        sessionEpoch: 0,
      };
      mockEpoch = 1; // signed out and in again since the request was first sent

      await expect(requestHandler(replay)).rejects.toBeInstanceOf(SessionChangedError);
      expect(replay.headers.Authorization).toBeUndefined();
    });

    it('refuses a request whose session changed while its token was being read', async () => {
      mockGetToken.mockImplementationOnce(async () => {
        mockEpoch++;
        return 'next-user-jwt';
      });
      const config = { headers: {} as Record<string, string>, url: '/api/v1/appointments', method: 'get' };

      await expect(requestHandler(config)).rejects.toBeInstanceOf(SessionChangedError);
      expect(config.headers.Authorization).toBeUndefined();
    });

    it('ends the session when the server rejects the refresh token', async () => {
      mockGetToken.mockResolvedValue('expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockRejectedValueOnce({ response: { status: 401 } });

      await expect(
        requestHandler({ headers: {}, url: '/api/v1/appointments', method: 'get' }),
      ).rejects.toEqual({ response: { status: 401 } });
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(mockSessionEnded).toHaveBeenCalledTimes(1);
    });

    it('keeps the session when renewal fails for lack of a network', async () => {
      expired();
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockRejectedValueOnce(new Error('Network Error'));

      await expect(
        requestHandler({ headers: {}, url: '/api/v1/appointments', method: 'get' }),
      ).rejects.toThrow('Network Error');
      expect(mockClearSession).not.toHaveBeenCalled();
      expect(mockRotateSession).not.toHaveBeenCalled();
    });

    it('keeps the session when the Keychain cannot read the refresh token', async () => {
      expired();
      mockGetRefreshToken.mockRejectedValue(new Error('Secure credential storage is unavailable.'));

      await expect(
        requestHandler({ headers: {}, url: '/api/v1/appointments', method: 'get' }),
      ).rejects.toThrow('Secure credential storage is unavailable.');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockClearSession).not.toHaveBeenCalled();
      expect(mockSessionEnded).not.toHaveBeenCalled();
    });

    it('stops a renewal when a logout happens while the refresh token is read', async () => {
      expired();
      mockGetRefreshToken.mockImplementationOnce(async () => {
        mockEpoch++;
        return REFRESH;
      });

      await expect(
        requestHandler({ headers: {}, url: '/api/v1/appointments', method: 'get' }),
      ).rejects.toBeInstanceOf(SessionChangedError);
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockRotateSession).not.toHaveBeenCalled();
      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('stores nothing from a renewal that a logout overtook, and does not send the request', async () => {
      expired();
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockImplementationOnce(async () => {
        mockEpoch++;
        return renewed;
      });
      const config = { headers: {} as Record<string, string>, url: '/api/v1/appointments', method: 'get' };

      await expect(requestHandler(config)).rejects.toBeInstanceOf(SessionChangedError);
      expect(mockRotateSession).toHaveBeenCalledWith(0, expect.anything());
      await expect(mockRotateSession.mock.results[0]!.value).resolves.toBe(false);
      expect(config.headers.Authorization).toBeUndefined();
      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('shares one renewal per session', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockResolvedValueOnce(renewed);

      await expect(Promise.all([renewSession(), renewSession()])).resolves.toEqual([
        'renewed-jwt',
        'renewed-jwt',
      ]);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('response interceptor', () => {
    it('clears credentials when a protected request returns 401', async () => {
      const error = {
        response: { status: 401 },
        config: { url: '/api/v1/appointments', method: 'get', sessionEpoch: 0 },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(mockSessionEnded).toHaveBeenCalledTimes(1);
    });

    it('ignores a 401 for a request sent before the current sign-in', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockEpoch = 1;
      const error = {
        response: { status: 401 },
        config: {
          url: '/api/v1/appointments',
          method: 'get',
          headers: { Authorization: 'Bearer previous-user-jwt' },
          sessionEpoch: 0,
        },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockClearSession).not.toHaveBeenCalled();
      expect(mockSessionEnded).not.toHaveBeenCalled();
    });

    it('does not let a late rejection of an overtaken renewal end the new sign-in', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockImplementationOnce(async () => {
        mockEpoch++; // a new sign-in while the old refresh token was being rejected
        throw { response: { status: 401 } };
      });
      const error = {
        response: { status: 401 },
        config: {
          url: '/api/v1/appointments',
          method: 'get',
          headers: { Authorization: 'Bearer previous-user-jwt' },
          sessionEpoch: 0,
        },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockClearSession).not.toHaveBeenCalled();
      expect(mockSessionEnded).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('ends the session when the renewal after a 401 is rejected, reporting the 401', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockRejectedValueOnce({ response: { status: 401 } });
      const error = {
        response: { status: 401 },
        config: {
          url: '/api/v1/auth/me',
          method: 'get',
          headers: { Authorization: 'Bearer revoked-jwt' },
          sessionEpoch: 0,
        },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(mockSessionEnded).toHaveBeenCalledTimes(1);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('keeps the session when the refresh token cannot be read', async () => {
      mockGetRefreshToken.mockRejectedValue(new Error('Secure credential storage is unavailable.'));
      const error = {
        response: { status: 401 },
        config: {
          url: '/api/v1/appointments',
          method: 'get',
          headers: { Authorization: 'Bearer jwt' },
          sessionEpoch: 0,
        },
      };

      await expect(responseErrorHandler(error)).rejects.toThrow(
        'Secure credential storage is unavailable.',
      );
      expect(mockClearSession).not.toHaveBeenCalled();
      expect(mockSessionEnded).not.toHaveBeenCalled();
    });

    it('clears credentials when /auth/me rejects the stored token', async () => {
      const error = {
        response: { status: 401 },
        config: { url: '/api/v1/auth/me', sessionEpoch: 0 },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockClearSession).toHaveBeenCalledTimes(1);
    });

    it('does not clear credentials for failed login, registration or logout', async () => {
      for (const url of [
        '/api/v1/auth/mobile/login',
        '/api/v1/auth/register',
        '/api/v1/auth/logout',
      ]) {
        jest.clearAllMocks();
        const error = { response: { status: 401 }, config: { url, method: 'post' } };
        await expect(responseErrorHandler(error)).rejects.toBe(error);
        expect(mockClearSession).not.toHaveBeenCalled();
      }
    });

    it('ignores a 401 on a public endpoint (it carried no token)', async () => {
      for (const config of [
        { url: '/api/v1/appointments', method: 'post' },
        { url: '/api/v1/appointments/public/busy-slots', method: 'get' },
        { url: '/api/v1/catalog', method: 'get' },
      ]) {
        jest.clearAllMocks();
        const error = { response: { status: 401 }, config };
        await expect(responseErrorHandler(error)).rejects.toBe(error);
        expect(mockClearSession).not.toHaveBeenCalled();
        expect(mockSessionEnded).not.toHaveBeenCalled();
      }
    });

    it('passes non-401 errors through without touching the session', async () => {
      const error = { response: { status: 429 }, config: { url: '/api/v1/auth/mobile/login' } };
      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockClearSession).not.toHaveBeenCalled();
      expect(mockSessionEnded).not.toHaveBeenCalled();
    });

    it('renews and replays a rejected request of any method that presented a bearer token', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      mockPost.mockResolvedValueOnce(renewed);
      mockRequest.mockResolvedValueOnce({ status: 204 });
      const config = {
        url: '/api/v1/appointments/5',
        method: 'delete',
        headers: { Authorization: 'Bearer revoked-jwt' },
        sessionEpoch: 0,
      };

      await expect(responseErrorHandler({ response: { status: 401 }, config })).resolves.toEqual({
        status: 204,
      });
      // The replay keeps the epoch it was first sent under (see the request interceptor).
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ sessionRetried: true, sessionEpoch: 0 }),
      );
      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('never renews a request that went out without a bearer token', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      const error = {
        response: { status: 401 },
        config: { url: '/api/v1/customer/appointments', method: 'get', headers: {}, sessionEpoch: 0 },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockClearSession).toHaveBeenCalledTimes(1);
    });

    it('ends the session when the replay after a renewal is rejected again', async () => {
      mockGetRefreshToken.mockResolvedValue(REFRESH);
      const error = {
        response: { status: 401 },
        config: {
          url: '/api/v1/appointments',
          method: 'get',
          headers: { Authorization: 'Bearer renewed-jwt' },
          sessionRetried: true,
          sessionEpoch: 0,
        },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockClearSession).toHaveBeenCalledTimes(1);
    });
  });
});
