import { apiClient } from './client';
import {
  AppointmentCreateRequest,
  AppointmentDashboardResponse,
  AppointmentItem,
  AppointmentUpdateRequest,
} from '../types/api';
import { parseContract } from './contracts';
import {
  appointmentCreateSchema,
  appointmentDashboardResponseSchema,
  appointmentResponseSchema,
  appointmentUpdateSchema,
} from '@taskflow/schemas';

export const appointmentsApi = {
  getAllAppointments: async (
    statusFilter?: string,
    search?: string,
    page = 0,
    size = 10
  ): Promise<AppointmentDashboardResponse> => {
    const params: Record<string, string | number> = {
      page,
      size,
    };
    if (statusFilter && statusFilter !== 'all') {
      params.status = statusFilter.toUpperCase();
    }
    if (search) {
      params.search = search;
    }
    const response = await apiClient.get<AppointmentDashboardResponse>('/api/v1/appointments', {
      params,
    });
    return parseContract(
      appointmentDashboardResponseSchema,
      response.data,
      'GET /api/v1/appointments',
    );
  },

  createAppointment: async (data: AppointmentCreateRequest): Promise<AppointmentItem> => {
    const payload = parseContract(appointmentCreateSchema, data, 'POST /api/v1/appointments');
    const response = await apiClient.post<AppointmentItem>('/api/v1/appointments', payload);
    return parseContract(
      appointmentResponseSchema,
      response.data,
      'POST /api/v1/appointments',
    );
  },

  getBusySlots: async (barberName: string, bookingDate: string): Promise<string[]> => {
    const response = await apiClient.get<string[]>('/api/v1/appointments/public/busy-slots', {
      params: { barberName, bookingDate },
    });
    return response.data;
  },

  publicCancelAppointment: async (publicId: string, email: string): Promise<void> => {
    await apiClient.put(`/api/v1/appointments/public/cancel/${publicId}`, { email });
  },

  updateAppointmentStatus: async (
    id: number,
    statusValue: AppointmentUpdateRequest['status']
  ): Promise<AppointmentItem> => {
    const payload = parseContract(
      appointmentUpdateSchema,
      { status: statusValue },
      'PUT /api/v1/appointments',
    );
    const response = await apiClient.put<AppointmentItem>(
      `/api/v1/appointments/${id}`,
      payload
    );
    return parseContract(appointmentResponseSchema, response.data, 'PUT /api/v1/appointments');
  },

  deleteAppointment: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/appointments/${id}`);
  },
};
