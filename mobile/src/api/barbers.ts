import { apiClient } from './client';
import { Barber, BarberTimeOff, BarberTimeOffRequest, PublicBarber } from '../types/api';

export const barbersApi = {
  getPublicBarbers: async (): Promise<PublicBarber[]> => {
    const response = await apiClient.get<PublicBarber[]>('/api/v1/barbers');
    return response.data;
  },

  getAdminBarbers: async (): Promise<Barber[]> => {
    const response = await apiClient.get<Barber[]>('/api/v1/barbers/admin');
    return response.data;
  },

  getTimeOff: async (barberId: number): Promise<BarberTimeOff[]> => {
    const response = await apiClient.get<BarberTimeOff[]>(`/api/v1/barbers/${barberId}/time-off`);
    return response.data;
  },

  addTimeOff: async (barberId: number, data: BarberTimeOffRequest): Promise<BarberTimeOff> => {
    const response = await apiClient.post<BarberTimeOff>(
      `/api/v1/barbers/${barberId}/time-off`,
      data
    );
    return response.data;
  },
};
