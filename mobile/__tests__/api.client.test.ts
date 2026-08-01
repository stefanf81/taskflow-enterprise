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

jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: { setState: jest.fn() },
}));

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

import '../src/api/client';

describe('mobile api client', () => {
  let requestHandler: (config: any) => Promise<any>;
  let requestErrorHandler: (error: any) => Promise<any>;
  let responseErrorHandler: (error: any) => Promise<any>;

  beforeAll(() => {
    requestHandler = mockRequestUse.mock.calls[0][0];
    requestErrorHandler = mockRequestUse.mock.calls[0][1];
    responseErrorHandler = mockResponseUse.mock.calls[0][1];
  });

  beforeEach(() => jest.clearAllMocks());

  it('does not enable native cookie credentials', () => {
    expect(capturedCreateConfig.withCredentials).toBe(false);
    expect(capturedCreateConfig.timeout).toBe(15000);
  });

  it('injects a SecureStore bearer token on API requests', async () => {
    mockGetToken.mockResolvedValueOnce('test-jwt');
    const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };

    await expect(requestHandler(config)).resolves.toBe(config);
    expect(config.headers.Authorization).toBe('Bearer test-jwt');
  });

  it('does not attach a stale token to bootstrap auth requests', async () => {
    mockGetToken.mockResolvedValue('stale-jwt');
    for (const url of ['/api/v1/auth/mobile/login', '/api/v1/auth/login', '/api/v1/auth/register']) {
      const config = { headers: {}, url, method: 'post' };
      await requestHandler(config);
      expect(config.headers.Authorization).toBeUndefined();
    }
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('omits Authorization when no token is stored', async () => {
    mockGetToken.mockResolvedValueOnce(null);
    const config = { headers: {}, url: '/api/v1/appointments', method: 'get' };

    await requestHandler(config);
    expect(config.headers.Authorization).toBeUndefined();
  });

  it('clears credentials when an authenticated request returns 401', async () => {
    const error = { response: { status: 401 }, config: { url: '/api/v1/appointments' } };

    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(mockRemoveToken).toHaveBeenCalledTimes(1);
    expect(mockRemoveUserData).toHaveBeenCalledTimes(1);
  });

  it('clears credentials when /auth/me rejects the stored token', async () => {
    const error = { response: { status: 401 }, config: { url: '/api/v1/auth/me' } };

    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(mockRemoveToken).toHaveBeenCalledTimes(1);
    expect(mockRemoveUserData).toHaveBeenCalledTimes(1);
  });

  it('does not clear credentials for failed login or registration', async () => {
    for (const url of ['/api/v1/auth/mobile/login', '/api/v1/auth/register']) {
      jest.clearAllMocks();
      const error = { response: { status: 401 }, config: { url } };
      await expect(responseErrorHandler(error)).rejects.toBe(error);
      expect(mockRemoveToken).not.toHaveBeenCalled();
      expect(mockRemoveUserData).not.toHaveBeenCalled();
    }
  });

  it('passes request errors through unchanged', async () => {
    const error = new Error('Config error');
    await expect(requestErrorHandler(error)).rejects.toBe(error);
  });
});
