import type { AxiosRequestConfig } from 'axios';
import { apiClient, type SessionRequestOptions } from '../../api/client';
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
   * the device, happens regardless of the outcome). When `captured` credentials are supplied,
   * the request uses them directly (`skipSessionAuth`) so clearing `storage` beforehand
   * neither drops the old bearer nor attaches a newer session's bearer.
   */
  logout: async (captured?: {
    accessToken?: string | null;
    refreshToken?: string | null;
  }): Promise<void> => {
    if (captured !== undefined) {
      const config: AxiosRequestConfig & SessionRequestOptions = {
        timeout: LOGOUT_TIMEOUT_MS,
        skipSessionAuth: true,
        headers: captured.accessToken
          ? { Authorization: `Bearer ${captured.accessToken}` }
          : undefined,
      };
      await apiClient.post(
        '/api/v1/auth/logout',
        captured.refreshToken ? { refreshToken: captured.refreshToken } : null,
        config,
      );
      return;
    }
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
