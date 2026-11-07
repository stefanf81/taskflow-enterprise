import { apiClient, RequestOptions } from '../../api/client';
import {
  AppointmentCreateRequest,
  AppointmentDashboardResponse,
  AppointmentItem,
  AppointmentUpdateRequest,
  CalendarExportResponse,
  GuestRescheduleRequest,
} from '../../types/api';
import { parseContract, parseRequest } from '../../api/contracts';
import {
  appointmentCreateSchema,
  appointmentDashboardResponseSchema,
  appointmentResponseSchema,
  appointmentUpdateSchema,
  busySlotsResponseSchema,
  calendarExportRequestSchema,
  calendarExportResponseSchema,
  guestRescheduleRequestSchema,
  rescheduleAvailabilityRequestSchema,
  shopInfoResponseSchema,
  type ShopInfoResponse,
} from '@taskflow/schemas';

export const appointmentsApi = {
  getAllAppointments: async (
    statusFilter?: string,
    search?: string,
    page = 0,
    size = 10,
    { signal }: RequestOptions = {},
  ): Promise<AppointmentDashboardResponse> => {
    const params: Record<string, string | number> = {
      page,
      size,
    };
    if (statusFilter && statusFilter !== 'all') {
      params.status = statusFilter.toUpperCase();
    }
    // The backend matches name/email/phone (contains) and publicId (exact);
    // surrounding whitespace would make an otherwise exact match fail.
    const term = search?.trim();
    if (term) {
      params.search = term;
    }
    const response = await apiClient.get<AppointmentDashboardResponse>('/api/v1/appointments', {
      params,
      signal,
    });
    return parseContract(
      appointmentDashboardResponseSchema,
      response.data,
      'GET /api/v1/appointments',
    );
  },

  createAppointment: async (
    data: AppointmentCreateRequest,
    idempotencyKey?: string
  ): Promise<AppointmentItem> => {
    const payload = parseRequest(appointmentCreateSchema, data, 'POST /api/v1/appointments');
    const response = idempotencyKey
      ? await apiClient.post<AppointmentItem>('/api/v1/appointments', payload, {
          headers: { 'Idempotency-Key': idempotencyKey },
        })
      : await apiClient.post<AppointmentItem>('/api/v1/appointments', payload);
    return parseContract(
      appointmentResponseSchema,
      response.data,
      'POST /api/v1/appointments',
    );
  },

  /**
   * The shop's time zone, booking window and opening hours: what the server counts as past,
   * bookable or closed is decided by them.
   */
  getShopInfo: async ({ signal }: RequestOptions = {}): Promise<ShopInfoResponse> => {
    const response = await apiClient.get<unknown>('/api/v1/appointments/public/shop', { signal });
    return parseContract(
      shopInfoResponseSchema,
      response.data,
      'GET /api/v1/appointments/public/shop',
    );
  },

  getBusySlots: async (
    barberName: string,
    bookingDate: string,
    serviceType?: string,
    { signal }: RequestOptions = {},
  ): Promise<string[]> => {
    // serviceType lets the server also mark slots where a long service would overlap a later
    // booking or run past closing time (otherwise the booking is rejected with 400 at submit).
    const response = await apiClient.get<string[]>('/api/v1/appointments/public/busy-slots', {
      params: serviceType ? { barberName, bookingDate, serviceType } : { barberName, bookingDate },
      signal,
    });
    return parseContract(
      busySlotsResponseSchema,
      response.data,
      'GET /api/v1/appointments/public/busy-slots',
    );
  },

  /**
   * The start times a signed-in customer's booking cannot move to on `bookingDate`: its own
   * barber and booked length, the booking itself not counted (getBusySlots counts it and takes
   * the length from today's catalog).
   */
  customerRescheduleAvailability: async (
    publicId: string,
    bookingDate: string,
    { signal }: RequestOptions = {},
  ): Promise<string[]> => {
    const response = await apiClient.get<string[]>(
      `/api/v1/customer/appointments/${encodeURIComponent(publicId)}/availability`,
      { params: { bookingDate }, signal },
    );
    return parseContract(
      busySlotsResponseSchema,
      response.data,
      'GET /api/v1/customer/appointments/{publicId}/availability',
    );
  },

  /** The same answer for a guest, who proves the booking with its email (in the body, not the URL). */
  publicRescheduleAvailability: async (
    publicId: string,
    email: string,
    bookingDate: string,
    { signal }: RequestOptions = {},
  ): Promise<string[]> => {
    const payload = parseRequest(
      rescheduleAvailabilityRequestSchema,
      { email, bookingDate },
      'POST /api/v1/appointments/public/reschedule/{publicId}/availability',
    );
    const response = await apiClient.post<string[]>(
      `/api/v1/appointments/public/reschedule/${encodeURIComponent(publicId)}/availability`,
      payload,
      { signal },
    );
    return parseContract(
      busySlotsResponseSchema,
      response.data,
      'POST /api/v1/appointments/public/reschedule/{publicId}/availability',
    );
  },

  publicCancelAppointment: async (publicId: string, email: string): Promise<void> => {
    await apiClient.put(`/api/v1/appointments/public/cancel/${encodeURIComponent(publicId)}`, { email });
  },

  updateAppointmentStatus: async (
    id: number,
    statusValue: AppointmentUpdateRequest['status']
  ): Promise<AppointmentItem> => {
    const payload = parseRequest(
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

  exportPublicCalendar: async (
    publicId: string,
    email: string,
  ): Promise<CalendarExportResponse> => {
    const payload = parseRequest(
      calendarExportRequestSchema,
      { email },
      'POST /api/v1/appointments/public/calendar/{publicId}',
    );
    const response = await apiClient.post<CalendarExportResponse>(
      `/api/v1/appointments/public/calendar/${encodeURIComponent(publicId)}`,
      payload,
    );
    return parseContract(
      calendarExportResponseSchema,
      response.data,
      'POST /api/v1/appointments/public/calendar/{publicId}',
    );
  },

  publicRescheduleAppointment: async (
    publicId: string,
    data: GuestRescheduleRequest,
  ): Promise<AppointmentItem> => {
    const payload = parseRequest(
      guestRescheduleRequestSchema,
      data,
      'PUT /api/v1/appointments/public/reschedule/{publicId}',
    );
    const response = await apiClient.put<AppointmentItem>(
      `/api/v1/appointments/public/reschedule/${encodeURIComponent(publicId)}`,
      payload,
    );
    return parseContract(
      appointmentResponseSchema,
      response.data,
      'PUT /api/v1/appointments/public/reschedule/{publicId}',
    );
  },
};
