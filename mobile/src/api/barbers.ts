import { apiClient } from './client';
import { Barber, BarberTimeOff, BarberTimeOffRequest, PublicBarber } from '../types/api';
import { parseContract, parseRequest } from './contracts';
import {
  barberResponseListSchema,
  barberTimeOffResponseListSchema,
  barberTimeOffResponseSchema,
  barberTimeOffSchema,
  publicBarberResponseListSchema,
} from '@taskflow/schemas';

export const barbersApi = {
  getPublicBarbers: async (): Promise<PublicBarber[]> => {
    const response = await apiClient.get<PublicBarber[]>('/api/v1/barbers');
    return parseContract(publicBarberResponseListSchema, response.data, 'GET /api/v1/barbers');
  },

  getAdminBarbers: async (): Promise<Barber[]> => {
    const response = await apiClient.get<Barber[]>('/api/v1/barbers/admin');
    return parseContract(
      barberResponseListSchema,
      response.data,
      'GET /api/v1/barbers/admin',
    );
  },

  getTimeOff: async (barberId: number): Promise<BarberTimeOff[]> => {
    const response = await apiClient.get<BarberTimeOff[]>(`/api/v1/barbers/${barberId}/time-off`);
    return parseContract(
      barberTimeOffResponseListSchema,
      response.data,
      'GET /api/v1/barbers/{id}/time-off',
    );
  },

  addTimeOff: async (barberId: number, data: BarberTimeOffRequest): Promise<BarberTimeOff> => {
    const payload = parseRequest(
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
