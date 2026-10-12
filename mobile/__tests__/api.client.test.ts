let mockGetToken: jest.Mock;
let mockGetTokenExpiry: jest.Mock;
let mockClearSession: jest.Mock;
const mockSessionEnded = jest.fn();

jest.mock('../src/utils/storage', () => {
  const getToken = jest.fn();
  const getTokenExpiry = jest.fn();
  const clearSession = jest.fn();
  mockGetToken = getToken;
  mockGetTokenExpiry = getTokenExpiry;
  mockClearSession = clearSession;
  return {
    storage: {
      getToken: (...args: unknown[]) => getToken(...args),
      getTokenExpiry: (...args: unknown[]) => getTokenExpiry(...args),
      clearSession: (...args: unknown[]) => clearSession(...args),
    },
  };
});

let capturedCreateConfig: Record<string, unknown>;
let mockRequestUse: jest.Mock;
let mockResponseUse: jest.Mock;

jest.mock('axios', () => {
  const requestUse = jest.fn();
  const responseUse = jest.fn();
  mockRequestUse = requestUse;
  mockResponseUse = responseUse;

  const instance: Record<string, unknown> = {
    defaults: {},
    interceptors: {
      request: { use: requestUse },
      response: { use: responseUse },
    },
  };

  return {
    create: (config: Record<string, unknown>) => {
      capturedCreateConfig = config;
      Object.assign(instance.defaults, config);
      return instance;
    },
  };
});

import { setSessionEndedHandler } from '../src/api/client';
import { queryClient } from '../src/query/queryClient';
import { SessionExpiredError } from '../src/utils/session';

describe('mobile api client', () => {
  let requestHandler: (config: any) => Promise<any>;
  let requestErrorHandler: (error: any) => Promise<any>;
  let responseErrorHandler: (error: any) => Promise<any>;

  beforeAll(() => {
    requestHandler = mockRequestUse.mock.calls[0][0];
    requestErrorHandler = mockRequestUse.mock.calls[0][1];
    responseErrorHandler = mockResponseUse.mock.calls[0][1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setSessionEndedHandler(() => mockSessionEnded());
    mockGetTokenExpiry.mockResolvedValue(null);
    mockClearSession.mockResolvedValue(undefined);
  });

  it('does not enable native cookie credentials', () => {
    expect(capturedCreateConfig.withCredentials).toBe(false);
    expect(capturedCreateConfig.timeout).toBe(10000);
  });

  describe('request interceptor', () => {
    it('injects a SecureStore bearer token on protected requests', async () => {
      mockGetToken.mockResolvedValueOnce('test-jwt');
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };

      await expect(requestHandler(config)).resolves.toBe(config);
      expect(config.headers.Authorization).toBe('Bearer test-jwt');
    });

    it('omits Authorization when no token is stored', async () => {
      mockGetToken.mockResolvedValueOnce(null);
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };

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
        ['put', '/api/v1/appointments/public/cancel/123e4567-e89b-12d3-a456-426614174000'],
        ['get', '/api/v1/catalog'],
        ['get', '/api/v1/barbers'],
        ['get', '/api/v1/reviews/public/barber-ratings'],
        ['post', '/api/v1/reviews/public/123e4567-e89b-12d3-a456-426614174000'],
      ];
      for (const [method, url] of publicCalls) {
        const config = { headers: {}, url, method };
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
        const config = { headers: {}, url, method };
        await requestHandler(config);
        expect(config.headers.Authorization).toBe('Bearer valid-jwt');
      }
    });

    it('drops an expired token before it is sent and ends the session cleanly', async () => {
      mockGetToken.mockResolvedValue('expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
      queryClient.setQueryData(['customerAppointments', 0, 10], { content: ['private'] });
      const config = { headers: {}, url: '/api/v1/customer/appointments', method: 'get' };

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
        requestHandler({ headers: {}, url: '/api/v1/appointments', method: 'get' }),
      ).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('keeps a token whose expiry is unknown', async () => {
      mockGetToken.mockResolvedValue('legacy-jwt');
      mockGetTokenExpiry.mockResolvedValue(null);
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };
      await requestHandler(config);
      expect(config.headers.Authorization).toBe('Bearer legacy-jwt');
    });

    it('lets logout go out unauthenticated when the token already expired', async () => {
      mockGetToken.mockResolvedValue('expired-jwt');
      mockGetTokenExpiry.mockResolvedValue(Date.now() - 1000);
      const config = { headers: {}, url: '/api/v1/auth/logout', method: 'post' };

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
  });

  describe('response interceptor', () => {
    it('clears credentials when a protected request returns 401', async () => {
      const error = {
        response: { status: 401 },
        config: { url: '/api/v1/appointments', method: 'get' },
      };

      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockClearSession).toHaveBeenCalledTimes(1);
      expect(mockSessionEnded).toHaveBeenCalledTimes(1);
    });

    it('clears credentials when /auth/me rejects the stored token', async () => {
      const error = { response: { status: 401 }, config: { url: '/api/v1/auth/me' } };

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
  });
});
