import { apiClient, RequestOptions } from '../../api/client';
import {
  Barber,
  BarberRequest,
  BarberScheduleResponse,
  BarberTimeOff,
  BarberTimeOffRequest,
  PublicBarber,
  ScheduleChangeRequest,
  SchedulePreviewResponse,
} from '../../types/api';
import { parseContract, parseRequest } from '../../api/contracts';
import {
  barberResponseListSchema,
  barberResponseSchema,
  barberScheduleResponseSchema,
  barberSchema,
  barberTimeOffResponseListSchema,
  barberTimeOffResponseSchema,
  barberTimeOffSchema,
  publicBarberResponseListSchema,
  scheduleChangeRequestSchema,
  schedulePreviewResponseSchema,
} from '@taskflow/schemas';

export const barbersApi = {
  getPublicBarbers: async ({ signal }: RequestOptions = {}): Promise<PublicBarber[]> => {
    const response = await apiClient.get<PublicBarber[]>('/api/v1/barbers', { signal });
    return parseContract(publicBarberResponseListSchema, response.data, 'GET /api/v1/barbers');
  },

  getAdminBarbers: async ({ signal }: RequestOptions = {}): Promise<Barber[]> => {
    const response = await apiClient.get<Barber[]>('/api/v1/barbers/admin', { signal });
    return parseContract(
      barberResponseListSchema,
      response.data,
      'GET /api/v1/barbers/admin',
    );
  },

  getTimeOff: async (
    barberId: number,
    { signal }: RequestOptions = {},
  ): Promise<BarberTimeOff[]> => {
    const response = await apiClient.get<BarberTimeOff[]>(`/api/v1/barbers/${barberId}/time-off`, {
      signal,
    });
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

  createBarber: async (data: BarberRequest): Promise<Barber> => {
    const payload = parseRequest(barberSchema, data, 'POST /api/v1/barbers');
    const response = await apiClient.post<Barber>('/api/v1/barbers', payload);
    return parseContract(barberResponseSchema, response.data, 'POST /api/v1/barbers');
  },

  getSchedule: async (
    barberId: number,
    { signal }: RequestOptions = {},
  ): Promise<BarberScheduleResponse> => {
    const response = await apiClient.get<BarberScheduleResponse>(
      `/api/v1/barbers/${barberId}/schedule`,
      { signal },
    );
    return parseContract(
      barberScheduleResponseSchema,
      response.data,
      'GET /api/v1/barbers/{id}/schedule',
    );
  },

  previewSchedule: async (
    barberId: number,
    data: ScheduleChangeRequest,
  ): Promise<SchedulePreviewResponse> => {
    const payload = parseRequest(
      scheduleChangeRequestSchema,
      data,
      'POST /api/v1/barbers/{id}/schedule/preview',
    );
    const response = await apiClient.post<SchedulePreviewResponse>(
      `/api/v1/barbers/${barberId}/schedule/preview`,
      payload,
    );
    return parseContract(
      schedulePreviewResponseSchema,
      response.data,
      'POST /api/v1/barbers/{id}/schedule/preview',
    );
  },

  updateSchedule: async (
    barberId: number,
    data: ScheduleChangeRequest,
  ): Promise<BarberScheduleResponse> => {
    const payload = parseRequest(
      scheduleChangeRequestSchema,
      data,
      'PUT /api/v1/barbers/{id}/schedule',
    );
    const response = await apiClient.put<BarberScheduleResponse>(
      `/api/v1/barbers/${barberId}/schedule`,
      payload,
    );
    return parseContract(
      barberScheduleResponseSchema,
      response.data,
      'PUT /api/v1/barbers/{id}/schedule',
    );
  },
};
