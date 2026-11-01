import { apiClient, RequestOptions } from '../../api/client';
import { AppointmentPage } from '../../types/api';
import { parseContract } from '../../api/contracts';
import { pagedAppointmentResponseSchema } from '@taskflow/schemas';

export const customerApi = {
  getAppointments: async (
    page = 0,
    size = 10,
    { signal }: RequestOptions = {},
  ): Promise<AppointmentPage> => {
    const response = await apiClient.get<AppointmentPage>(
      '/api/v1/customer/appointments',
      { params: { page, size }, signal }
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
