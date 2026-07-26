// ============================================================
// Mocks — factories are self-contained (jest.mock is hoisted
// above imports, so const declarations are NOT available inside
// the factory at call time).  We use `let` + assignment inside
// the factory to expose references.
// ============================================================

let mockGetToken: jest.Mock;
let mockRemoveToken: jest.Mock;
let mockRemoveUserData: jest.Mock;

jest.mock('../src/utils/storage', () => {
  const getToken = jest.fn();
  const removeToken = jest.fn();
  const removeUserData = jest.fn();
  mockGetToken = getToken;
  mockRemoveToken = removeToken;
  mockRemoveUserData = removeUserData;
  return {
    storage: {
      getToken: (...args: unknown[]) => getToken(...args),
      removeToken: (...args: unknown[]) => removeToken(...args),
      removeUserData: (...args: unknown[]) => removeUserData(...args),
    },
  };
});

// useAuthStore is dynamically imported inside the 401 handler.
// The mock exists so the dynamic import resolves, but we don't
// assert on it here – the store reset is verified in useAuthStore
// unit tests.
jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: {
    setState: jest.fn(),
  },
}));

// Axios
let capturedCreateConfig: Record<string, unknown>;
let mockRequestUse: jest.Mock;
let mockResponseUse: jest.Mock;
let mockAxiosGet: jest.Mock;

jest.mock('axios', () => {
  const reqUse = jest.fn();
  const resUse = jest.fn();
  const axiosGet = jest.fn();
  mockRequestUse = reqUse;
  mockResponseUse = resUse;
  mockAxiosGet = axiosGet;

  const instance: Record<string, unknown> = {
    defaults: {},
    interceptors: {
      request: { use: reqUse },
      response: { use: resUse },
    },
  };

  return {
    create: (config: Record<string, unknown>) => {
      capturedCreateConfig = config;
      Object.assign(instance.defaults, config);
      return instance;
    },
    get: (...args: unknown[]) => axiosGet(...args),
  };
});

// ============================================================
// Subject under test (import triggers interceptor registration)
// ============================================================
import { setCsrfToken } from '../src/api/client';

const origDev = globalThis.__DEV__;

describe('api / client', () => {
  let requestHandler: (config: any) => Promise<any>;
  let requestErrorHandler: (error: any) => Promise<any>;
  let responseErrorHandler: (error: any) => Promise<any>;

  beforeAll(() => {
    // Handlers were registered when the module evaluated
    requestHandler = mockRequestUse.mock.calls[0][0];
    requestErrorHandler = mockRequestUse.mock.calls[0][1];
    responseErrorHandler = mockResponseUse.mock.calls[0][1]; // error handler
  });

  afterAll(() => {
    (globalThis as any).__DEV__ = origDev;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setCsrfToken(null); // Reset CSRF between each test
  });

  // ===================== BASE URL =====================
  describe('axios.create baseURL', () => {
    it('defaults to localhost:8080 for non-Android', () => {
      expect(capturedCreateConfig?.baseURL).toBe('http://localhost:8080');
    });

    it('sets withCredentials to true', () => {
      expect(capturedCreateConfig?.withCredentials).toBe(true);
    });

    it('sets 15s timeout', () => {
      expect(capturedCreateConfig?.timeout).toBe(15000);
    });

    it('has application/json content type', () => {
      expect(
        (capturedCreateConfig?.headers as Record<string, string>)?.['Content-Type'],
      ).toBe('application/json');
    });
  });

  // ===================== REQUEST INTERCEPTOR — JWT =====================
  describe('request interceptor – JWT injection', () => {
    it('injects Bearer token from storage', async () => {
      mockGetToken.mockResolvedValueOnce('test-jwt');
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };
      const result = await requestHandler(config);
      expect(result.headers.Authorization).toBe('Bearer test-jwt');
    });

    it('omits Authorization header when no token is stored', async () => {
      mockGetToken.mockResolvedValueOnce(null);
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };
      const result = await requestHandler(config);
      expect(result.headers.Authorization).toBeUndefined();
    });

    it('returns the config for chaining', async () => {
      mockGetToken.mockResolvedValueOnce('tok');
      const config = { headers: {}, url: '/test', method: 'post' };
      const result = await requestHandler(config);
      expect(result).toBe(config);
    });
  });

  // ===================== REQUEST INTERCEPTOR — CSRF =====================
  describe('request interceptor – CSRF', () => {
    it('skips CSRF for safe GET requests', async () => {
      const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(config.headers['X-XSRF-TOKEN']).toBeUndefined();
    });

    it('skips CSRF for HEAD requests', async () => {
      const config = { headers: {}, url: '/api/v1/appointments', method: 'head' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('skips CSRF for OPTIONS requests', async () => {
      const config = { headers: {}, url: '/api/v1/appointments', method: 'options' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('skips CSRF on exempt POST /api/v1/auth/login', async () => {
      const config = { headers: {}, url: '/api/v1/auth/login', method: 'post' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('skips CSRF on exempt POST /api/v1/auth/register', async () => {
      const config = { headers: {}, url: '/api/v1/auth/register', method: 'post' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('skips CSRF on exempt POST /api/v1/appointments', async () => {
      const config = { headers: {}, url: '/api/v1/appointments', method: 'post' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('skips CSRF on exempt POST /api/v1/appointments/public/cancel/*', async () => {
      const config = {
        headers: {},
        url: '/api/v1/appointments/public/cancel/TF-0001',
        method: 'post',
      };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('skips CSRF on exempt POST /api/v1/reviews/public/*', async () => {
      const config = { headers: {}, url: '/api/v1/reviews/public/TF-0001', method: 'post' };
      await requestHandler(config);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('lazy-fetches CSRF token on first non-exempt state-changing request', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { token: 'csrf-abc' } });
      const config = { headers: {}, url: '/api/v1/some-resource', method: 'post' };
      await requestHandler(config);

      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/csrf'),
        expect.objectContaining({ withCredentials: true }),
      );
      expect(config.headers['X-XSRF-TOKEN']).toBe('csrf-abc');
    });

    it('uses cached CSRF token without re-fetching', async () => {
      setCsrfToken('cached-token');
      const config = { headers: {}, url: '/api/v1/some-resource', method: 'post' };
      await requestHandler(config);

      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(config.headers['X-XSRF-TOKEN']).toBe('cached-token');
    });

    it('re-fetches CSRF only once when cache is null (subsequent calls use cache)', async () => {
      mockAxiosGet.mockResolvedValue({ data: { token: 'csrf-once' } });
      setCsrfToken(null);

      const config1 = { headers: {}, url: '/api/v1/foo', method: 'post' };
      await requestHandler(config1);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      expect(config1.headers['X-XSRF-TOKEN']).toBe('csrf-once');

      const config2 = { headers: {}, url: '/api/v1/bar', method: 'delete' };
      await requestHandler(config2);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      expect(config2.headers['X-XSRF-TOKEN']).toBe('csrf-once');
    });

    it('proceeds without CSRF header when lazy-fetch fails', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('Network error'));
      const config = { headers: {}, url: '/api/v1/some-resource', method: 'post' };
      await requestHandler(config);

      expect(config.headers['X-XSRF-TOKEN']).toBeUndefined();
    });

    it('applies CSRF for non-exempt PUT/PATCH/DELETE as well', async () => {
      mockAxiosGet.mockResolvedValue({ data: { token: 'csrf-mut' } });
      for (const method of ['put', 'patch', 'delete']) {
        const config = { headers: {}, url: '/api/v1/some-resource', method };
        const result = await requestHandler(config);
        expect(result.headers['X-XSRF-TOKEN']).toBe('csrf-mut');
      }
    });
  });

  // ===================== REQUEST ERROR HANDLER =====================
  describe('request error handler', () => {
    it('rejects with the same error', async () => {
      const error = new Error('Config error');
      await expect(requestErrorHandler(error)).rejects.toBe(error);
    });
  });

  // ===================== RESPONSE INTERCEPTOR — 401 =====================
  describe('response interceptor – 401 auto-logout', () => {
    it('clears credentials (token + user data) on 401 for non-auth endpoints', async () => {
      const error = {
        response: { status: 401 },
        config: { url: '/api/v1/appointments' },
      };
      await expect(responseErrorHandler(error)).rejects.toEqual(error);

      expect(mockRemoveToken).toHaveBeenCalledTimes(1);
      expect(mockRemoveUserData).toHaveBeenCalledTimes(1);
    });

    it('does NOT clear credentials on 401 for /api/v1/auth/* endpoints', async () => {
      const authPaths = ['/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/auth/register'];
      for (const url of authPaths) {
        jest.clearAllMocks();
        const error = { response: { status: 401 }, config: { url } };
        await expect(responseErrorHandler(error)).rejects.toEqual(error);
        expect(mockRemoveToken).not.toHaveBeenCalled();
        expect(mockRemoveUserData).not.toHaveBeenCalled();
      }
    });

    it('passes through non-401 errors unchanged', async () => {
      const error = { response: { status: 403 }, config: { url: '/api/v1/appointments' } };
      await expect(responseErrorHandler(error)).rejects.toEqual(error);
      expect(mockRemoveToken).not.toHaveBeenCalled();
    });

    it('passes through 500 errors unchanged', async () => {
      const error = { response: { status: 500 }, config: { url: '/api/v1/appointments' } };
      await expect(responseErrorHandler(error)).rejects.toEqual(error);
      expect(mockRemoveToken).not.toHaveBeenCalled();
    });

    it('passes through network errors (no response object)', async () => {
      const error = new Error('Network Error');
      await expect(responseErrorHandler(error)).rejects.toEqual(error);
      expect(mockRemoveToken).not.toHaveBeenCalled();
    });

    it('handles errors with response but no config (url defaults to "")', async () => {
      const error = { response: { status: 401 } };
      await expect(responseErrorHandler(error)).rejects.toEqual(error);
      expect(mockRemoveToken).toHaveBeenCalled();
      expect(mockRemoveUserData).toHaveBeenCalled();
    });
  });

  // ===================== setCsrfToken =====================
  describe('setCsrfToken', () => {
    it('accepts null to clear the cached token', () => {
      expect(() => setCsrfToken(null)).not.toThrow();
    });

    it('accepts a string to set the cached token', () => {
      expect(() => setCsrfToken('my-token')).not.toThrow();
    });
  });
});
