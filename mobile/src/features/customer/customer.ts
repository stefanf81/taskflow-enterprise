import { apiClient, RequestOptions } from '../../api/client';
import {
  AppointmentItem,
  AppointmentPage,
  CalendarExportResponse,
  RescheduleRequest,
} from '../../types/api';
import { parseContract, parseRequest } from '../../api/contracts';
import {
  appointmentResponseSchema,
  calendarExportResponseSchema,
  pagedAppointmentResponseSchema,
  rescheduleRequestSchema,
} from '@taskflow/schemas';

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
    await apiClient.delete(`/api/v1/customer/appointments/${encodeURIComponent(publicId)}`);
  },

  exportCalendar: async (publicId: string): Promise<CalendarExportResponse> => {
    const response = await apiClient.get<CalendarExportResponse>(
      `/api/v1/customer/appointments/${encodeURIComponent(publicId)}/calendar`,
    );
    return parseContract(
      calendarExportResponseSchema,
      response.data,
      'GET /api/v1/customer/appointments/{publicId}/calendar',
    );
  },

  rescheduleAppointment: async (
    publicId: string,
    data: RescheduleRequest,
  ): Promise<AppointmentItem> => {
    const payload = parseRequest(
      rescheduleRequestSchema,
      data,
      'PUT /api/v1/customer/appointments/{publicId}/reschedule',
    );
    const response = await apiClient.put<AppointmentItem>(
      `/api/v1/customer/appointments/${encodeURIComponent(publicId)}/reschedule`,
      payload,
    );
    return parseContract(
      appointmentResponseSchema,
      response.data,
      'PUT /api/v1/customer/appointments/{publicId}/reschedule',
    );
  },
};
