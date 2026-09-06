import { apiClient } from './client';
import { AppointmentPage } from '../types/api';

export const customerApi = {
  getAppointments: async (page = 0, size = 10): Promise<AppointmentPage> => {
    const response = await apiClient.get<AppointmentPage>(
      '/api/v1/customer/appointments',
      { params: { page, size } }
    );
    return response.data;
  },

  cancelAppointment: async (publicId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/customer/appointments/${publicId}`);
  },
};
