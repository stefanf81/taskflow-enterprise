import { apiClient } from './client';
import { AppointmentPage } from '../types/api';
import { parseContract } from './contracts';
import { pagedAppointmentResponseSchema } from '@taskflow/schemas';

export const customerApi = {
  getAppointments: async (page = 0, size = 10): Promise<AppointmentPage> => {
    const response = await apiClient.get<AppointmentPage>(
      '/api/v1/customer/appointments',
      { params: { page, size } }
    );
    return parseContract(
      pagedAppointmentResponseSchema,
      response.data,
      'GET /api/v1/customer/appointments',
    );
  },

  cancelAppointment: async (publicId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/customer/appointments/${publicId}`);
  },
};
