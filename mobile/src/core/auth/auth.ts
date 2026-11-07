import { apiClient } from '../../api/client';
import { storage } from '../../utils/storage';
import { parseContract, parseRequest } from '../../api/contracts';
import { LoginRequest, LoginResponse, MobileLoginResponse, RegisterRequest } from '../../types/api';
import {
  loginResponseSchema,
  loginSchema,
  mobileLoginResponseSchema,
  registerResponseSchema,
  registerSchema,
} from '@taskflow/schemas';

const LOGOUT_TIMEOUT_MS = 5000;

export const authApi = {
  login: async (credentials: LoginRequest): Promise<MobileLoginResponse> => {
    const payload = parseRequest(
      loginSchema,
      credentials,
      'POST /api/v1/auth/mobile/login'
    );
    const response = await apiClient.post<MobileLoginResponse>(
      '/api/v1/auth/mobile/login',
      payload
    );
    return parseContract(
      mobileLoginResponseSchema,
      response.data,
      'POST /api/v1/auth/mobile/login'
    );
  },

  me: async (): Promise<LoginResponse> => {
    const response = await apiClient.get<LoginResponse>('/api/v1/auth/me');
    return parseContract(loginResponseSchema, response.data, 'GET /api/v1/auth/me');
  },

  /**
   * Revokes the bearer token and its refresh session server-side. Callers treat this as
   * best effort (short timeout; local cleanup, which also erases the refresh token from
   * the device, happens regardless of the outcome). An unreadable refresh token still lets
   * the logout go out: a valid bearer token alone revokes its whole refresh session.
   */
  logout: async (): Promise<void> => {
    const refreshToken = await storage.getRefreshToken().catch(() => null);
    await apiClient.post(
      '/api/v1/auth/logout',
      refreshToken ? { refreshToken } : null,
      { timeout: LOGOUT_TIMEOUT_MS },
    );
  },

  register: async (data: RegisterRequest): Promise<void> => {
    const payload = parseRequest(registerSchema, data, 'POST /api/v1/auth/register');
    const response = await apiClient.post('/api/v1/auth/register', payload);
    parseContract(registerResponseSchema, response.data, 'POST /api/v1/auth/register');
  },
};
