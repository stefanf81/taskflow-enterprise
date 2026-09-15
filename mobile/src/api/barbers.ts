import { apiClient } from './client';
import { Barber, BarberTimeOff, BarberTimeOffRequest, PublicBarber } from '../types/api';
import { parseContract } from './contracts';
import {
  barberResponseSchema,
  barberTimeOffResponseSchema,
  barberTimeOffSchema,
  publicBarberResponseSchema,
} from '@taskflow/schemas';

export const barbersApi = {
  getPublicBarbers: async (): Promise<PublicBarber[]> => {
    const response = await apiClient.get<PublicBarber[]>('/api/v1/barbers');
    return parseContract(publicBarberResponseSchema.array(), response.data, 'GET /api/v1/barbers');
  },

  getAdminBarbers: async (): Promise<Barber[]> => {
    const response = await apiClient.get<Barber[]>('/api/v1/barbers/admin');
    return parseContract(
      barberResponseSchema.array(),
      response.data,
      'GET /api/v1/barbers/admin',
    );
  },

  getTimeOff: async (barberId: number): Promise<BarberTimeOff[]> => {
    const response = await apiClient.get<BarberTimeOff[]>(`/api/v1/barbers/${barberId}/time-off`);
    return parseContract(
      barberTimeOffResponseSchema.array(),
      response.data,
      'GET /api/v1/barbers/{id}/time-off',
    );
  },

  addTimeOff: async (barberId: number, data: BarberTimeOffRequest): Promise<BarberTimeOff> => {
    const payload = parseContract(
      barberTimeOffSchema,
      data,
      'POST /api/v1/barbers/{id}/time-off',
    );
    const response = await apiClient.post<BarberTimeOff>(
      `/api/v1/barbers/${barberId}/time-off`,
      payload
    );
    return parseContract(
      barberTimeOffResponseSchema,
      response.data,
      'POST /api/v1/barbers/{id}/time-off',
    );
  },
};
