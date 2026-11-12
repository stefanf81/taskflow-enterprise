import { HttpClient, HttpContext, HttpParams, HttpResourceRequest } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import {
  AppointmentCreateRequest,
  AppointmentItem,
  AppointmentUpdateRequest,
  CalendarExportResponse,
  GuestRescheduleRequest,
  RescheduleRequest,
} from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest, parseResponse } from './request-validation';
import {
  appointmentCreateSchema,
  appointmentResponseSchema,
  appointmentUpdateSchema,
  busySlotsResponseSchema,
  calendarExportRequestSchema,
  calendarExportResponseSchema,
  cancelRequestSchema,
  guestRescheduleRequestSchema,
  rescheduleAvailabilityRequestSchema,
  rescheduleRequestSchema,
} from '@taskflow/schemas';

/** Appointment lifecycle endpoints (`/api/v1/appointments`, `/api/v1/customer`). */
@Service()
export class AppointmentsApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/appointments';
  private readonly customerBase = '/api/v1/customer/appointments';

  /** Public shop facts (time zone), the way the server reads booking dates. */
  readonly shopInfoUrl = `${this.base}/public/shop`;

  /** Resource URL for the admin appointment dashboard (single source of the endpoint). */
  dashboardUrl(statusFilter: string, search: string, page: number, size: number): string {
    let params = new HttpParams().set('page', page.toString()).set('size', size.toString());
    if (statusFilter && statusFilter !== 'all') {
      params = params.set('status', statusFilter.toUpperCase());
    }
    if (search) {
      params = params.set('search', search);
    }
    return `${this.base}?${params.toString()}`;
  }

  /** Resource URL for the customer portal appointment history. */
  customerPageUrl(page: number, size: number): string {
    return `${this.customerBase}?page=${page}&size=${size}`;
  }

  /**
   * Creates a booking. An optional stable {@code Idempotency-Key} makes an
   * ambiguous-timeout retry replay the original booking instead of creating a
   * second one (the backend may resolve "No Preference" to a different barber).
   */
  createAppointment(
    request: AppointmentCreateRequest,
    idempotencyKey?: string,
  ): Observable<AppointmentItem> {
    return defer(() => {
      const validated = parseRequest(appointmentCreateSchema, request);
      return this.http
        .post<AppointmentItem>(this.base, validated, {
          ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
          context: new HttpContext().set(PUBLIC_REQUEST, true),
        })
        .pipe(
          map((raw) => parseResponse(appointmentResponseSchema, raw, 'POST /api/v1/appointments')),
        );
    });
  }

  /**
   * Resource request for the slots of one barber (or the "No Preference" sentinel, which the
   * server resolves across all barbers) on one date that cannot be booked. Pair it with
   * {@link parseBusySlots}.
   */
  busySlotsRequest(
    barberName: string,
    bookingDate: string,
    serviceType?: string,
  ): HttpResourceRequest {
    return {
      url: `${this.base}/public/busy-slots`,
      // `serviceType` lets the server also mark slots where a long service would overlap a later
      // booking or run past closing time (otherwise the booking would be rejected with 400 at
      // submit).
      params: { barberName, bookingDate, ...(serviceType ? { serviceType } : {}) },
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    };
  }

  /** Validates a busy-slots response (a list of `HH:mm` strings). */
  readonly parseBusySlots = (raw: unknown): string[] =>
    parseResponse(busySlotsResponseSchema, raw, 'GET /api/v1/appointments/public/busy-slots');

  /**
   * Resource request for the start times a signed-in customer's booking cannot move to on
   * `bookingDate`: its own barber and booked length, the booking itself not counted (the
   * create-time {@link busySlotsRequest} counts it and reads the length from today's catalog).
   * Pair it with {@link parseRescheduleAvailability}.
   */
  customerRescheduleAvailabilityRequest(
    publicId: string,
    bookingDate: string,
  ): HttpResourceRequest {
    return {
      url: `${this.customerBase}/${encodeURIComponent(publicId)}/availability`,
      params: { bookingDate },
    };
  }

  /**
   * The same answer for a guest, who proves the booking with its email. A POST, so the email
   * stays out of the URL (and out of access logs).
   */
  publicRescheduleAvailabilityRequest(
    publicId: string,
    email: string,
    bookingDate: string,
  ): HttpResourceRequest {
    const validated = parseRequest(rescheduleAvailabilityRequestSchema, { email, bookingDate });
    return {
      url: `${this.base}/public/reschedule/${encodeURIComponent(publicId)}/availability`,
      method: 'POST',
      body: validated,
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    };
  }

  /** Validates a reschedule-availability response (`HH:mm` strings) of the guest or customer endpoint. */
  parseRescheduleAvailability(raw: unknown, guest: boolean): string[] {
    return parseResponse(
      busySlotsResponseSchema,
      raw,
      guest
        ? 'POST /api/v1/appointments/public/reschedule/{publicId}/availability'
        : 'GET /api/v1/customer/appointments/{publicId}/availability',
    );
  }

  publicCancelAppointment(publicId: string, email: string): Observable<void> {
    return defer(() => {
      const validated = parseRequest(cancelRequestSchema, { email });
      return this.http.put<void>(
        `${this.base}/public/cancel/${encodeURIComponent(publicId)}`,
        validated,
        { context: new HttpContext().set(PUBLIC_REQUEST, true) },
      );
    });
  }

  updateAppointmentStatus(
    id: number,
    statusValue: AppointmentUpdateRequest['status'],
  ): Observable<AppointmentItem> {
    return defer(() => {
      const validated = parseRequest(appointmentUpdateSchema, { status: statusValue });
      return this.http
        .put<AppointmentItem>(`${this.base}/${id}`, validated)
        .pipe(
          map((raw) =>
            parseResponse(appointmentResponseSchema, raw, `PUT /api/v1/appointments/${id}`),
          ),
        );
    });
  }

  deleteAppointment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  cancelCustomerAppointment(publicId: string): Observable<void> {
    return this.http.delete<void>(`${this.customerBase}/${encodeURIComponent(publicId)}`);
  }

  exportPublicCalendar(publicId: string, email: string): Observable<CalendarExportResponse> {
    return defer(() => {
      const validated = parseRequest(calendarExportRequestSchema, { email });
      return this.http
        .post<CalendarExportResponse>(
          `${this.base}/public/calendar/${encodeURIComponent(publicId)}`,
          validated,
          { context: new HttpContext().set(PUBLIC_REQUEST, true) },
        )
        .pipe(
          map((raw) =>
            parseResponse(
              calendarExportResponseSchema,
              raw,
              'POST /api/v1/appointments/public/calendar/{publicId}',
            ),
          ),
        );
    });
  }

  exportCustomerCalendar(publicId: string): Observable<CalendarExportResponse> {
    return this.http
      .get<CalendarExportResponse>(`${this.customerBase}/${encodeURIComponent(publicId)}/calendar`)
      .pipe(
        map((raw) =>
          parseResponse(
            calendarExportResponseSchema,
            raw,
            'GET /api/v1/customer/appointments/{publicId}/calendar',
          ),
        ),
      );
  }

  publicRescheduleAppointment(
    publicId: string,
    request: GuestRescheduleRequest,
  ): Observable<AppointmentItem> {
    return defer(() => {
      const validated = parseRequest(guestRescheduleRequestSchema, request);
      return this.http
        .put<AppointmentItem>(
          `${this.base}/public/reschedule/${encodeURIComponent(publicId)}`,
          validated,
          { context: new HttpContext().set(PUBLIC_REQUEST, true) },
        )
        .pipe(
          map((raw) =>
            parseResponse(
              appointmentResponseSchema,
              raw,
              'PUT /api/v1/appointments/public/reschedule/{publicId}',
            ),
          ),
        );
    });
  }

  rescheduleCustomerAppointment(
    publicId: string,
    request: RescheduleRequest,
  ): Observable<AppointmentItem> {
    return defer(() => {
      const validated = parseRequest(rescheduleRequestSchema, request);
      return this.http
        .put<AppointmentItem>(
          `${this.customerBase}/${encodeURIComponent(publicId)}/reschedule`,
          validated,
        )
        .pipe(
          map((raw) =>
            parseResponse(
              appointmentResponseSchema,
              raw,
              'PUT /api/v1/customer/appointments/{publicId}/reschedule',
            ),
          ),
        );
    });
  }
}
