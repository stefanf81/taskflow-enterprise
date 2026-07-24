import { apiClient } from './client';
import {
  AppointmentCreateRequest,
  AppointmentDashboardResponse,
  AppointmentItem,
  AppointmentUpdateRequest,
} from '../types/api';

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
    return response.data;
  },

  createAppointment: async (data: AppointmentCreateRequest): Promise<AppointmentItem> => {
    const response = await apiClient.post<AppointmentItem>('/api/v1/appointments', data);
    return response.data;
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
    const request: AppointmentUpdateRequest = { status: statusValue };
    const response = await apiClient.put<AppointmentItem>(
      `/api/v1/appointments/${id}`,
      request
    );
    return response.data;
  },

  deleteAppointment: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/appointments/${id}`);
  },
};
