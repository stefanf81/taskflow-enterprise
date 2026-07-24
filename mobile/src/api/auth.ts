import { apiClient } from './client';
import { LoginRequest, LoginResponse, RegisterRequest } from '../types/api';

export const authApi = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/api/v1/auth/login', credentials);
    return response.data;
  },

  me: async (): Promise<LoginResponse> => {
    const response = await apiClient.get<LoginResponse>('/api/v1/auth/me');
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<void> => {
    await apiClient.post('/api/v1/auth/register', data);
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/api/v1/auth/logout');
  },

  fetchCsrfToken: async (): Promise<string> => {
    const response = await apiClient.get<{ token: string }>('/api/v1/auth/csrf');
    return response.data.token;
  },
};
