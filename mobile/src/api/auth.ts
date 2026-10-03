import { apiClient } from './client';
import { parseContract } from './contracts';
import { LoginRequest, LoginResponse, MobileLoginResponse, RegisterRequest } from '../types/api';
import {
  loginResponseSchema,
  loginSchema,
  mobileLoginResponseSchema,
  registerResponseSchema,
  registerSchema,
} from '@taskflow/schemas';

export const authApi = {
  login: async (credentials: LoginRequest): Promise<MobileLoginResponse> => {
    const payload = parseContract(
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

  register: async (data: RegisterRequest): Promise<void> => {
    const payload = parseContract(registerSchema, data, 'POST /api/v1/auth/register');
    const response = await apiClient.post('/api/v1/auth/register', payload);
    parseContract(registerResponseSchema, response.data, 'POST /api/v1/auth/register');
  },
};
