import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import {
  AppointmentCreateRequest,
  AppointmentItem,
  AppointmentUpdateRequest,
} from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest, parseResponse } from './request-validation';
import {
  appointmentCreateSchema,
  appointmentResponseSchema,
  appointmentUpdateSchema,
  busySlotsResponseSchema,
} from '@taskflow/schemas';

/** Appointment lifecycle endpoints (`/api/v1/appointments`, `/api/v1/customer`). */
@Service()
export class AppointmentsApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/appointments';
  private readonly customerBase = '/api/v1/customer/appointments';

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

  getBusySlots(barberName: string, bookingDate: string): Observable<string[]> {
    const params = new HttpParams().set('barberName', barberName).set('bookingDate', bookingDate);
    return this.http
      .get<string[]>(`${this.base}/public/busy-slots`, {
        params,
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      })
      .pipe(
        map((raw) =>
          parseResponse(busySlotsResponseSchema, raw, 'GET /api/v1/appointments/public/busy-slots'),
        ),
      );
  }

  publicCancelAppointment(publicId: string, email: string): Observable<void> {
    return this.http.put<void>(
      `${this.base}/public/cancel/${publicId}`,
      { email },
      { context: new HttpContext().set(PUBLIC_REQUEST, true) },
    );
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
    return this.http.delete<void>(`${this.customerBase}/${publicId}`);
  }
}
