import { apiClient } from './client';
import { LoginRequest, LoginResponse, MobileLoginResponse, RegisterRequest } from '../types/api';

export const authApi = {
  login: async (credentials: LoginRequest): Promise<MobileLoginResponse> => {
    const response = await apiClient.post<MobileLoginResponse>('/api/v1/auth/mobile/login', credentials);
    return response.data;
  },

  me: async (): Promise<LoginResponse> => {
    const response = await apiClient.get<LoginResponse>('/api/v1/auth/me');
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<void> => {
    await apiClient.post('/api/v1/auth/register', data);
  },

};
