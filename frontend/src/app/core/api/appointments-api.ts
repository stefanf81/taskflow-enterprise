import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, Observable } from 'rxjs';
import {
  AppointmentCreateRequest,
  AppointmentItem,
  AppointmentUpdateRequest,
} from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest } from './request-validation';
import { appointmentCreateSchema, appointmentUpdateSchema } from '@taskflow/schemas';

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

  createAppointment(request: AppointmentCreateRequest): Observable<AppointmentItem> {
    return defer(() => {
      const validated = parseRequest(appointmentCreateSchema, request);
      return this.http.post<AppointmentItem>(this.base, validated, {
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      });
    });
  }

  getBusySlots(barberName: string, bookingDate: string): Observable<string[]> {
    const params = new HttpParams().set('barberName', barberName).set('bookingDate', bookingDate);
    return this.http.get<string[]>(`${this.base}/public/busy-slots`, {
      params,
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    });
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
      return this.http.put<AppointmentItem>(`${this.base}/${id}`, validated);
    });
  }

  deleteAppointment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  cancelCustomerAppointment(publicId: string): Observable<void> {
    return this.http.delete<void>(`${this.customerBase}/${publicId}`);
  }
}
