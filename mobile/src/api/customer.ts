import { apiClient } from './client';
import { AppointmentItem } from '../types/api';

export const customerApi = {
  getAppointments: async (
    page = 0,
    size = 10
  ): Promise<{ content: AppointmentItem[]; totalPages: number }> => {
    const response = await apiClient.get<{ content: AppointmentItem[]; totalPages: number }>(
      '/api/v1/customer/appointments',
      { params: { page, size } }
    );
    return response.data;
  },

  cancelAppointment: async (publicId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/customer/appointments/${publicId}`);
  },
};
