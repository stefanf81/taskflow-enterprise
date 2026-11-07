import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import {
  Barber,
  BarberRequest,
  BarberScheduleResponse,
  BarberTimeOff,
  BarberTimeOffRequest,
  ScheduleChangeRequest,
  SchedulePreviewResponse,
} from '../../types/api';
import { parseRequest, parseResponse } from './request-validation';
import {
  barberResponseSchema,
  barberScheduleResponseSchema,
  barberSchema,
  barberTimeOffSchema,
  scheduleChangeRequestSchema,
  schedulePreviewResponseSchema,
} from '@taskflow/schemas';

/** Barber directory, schedules and time-off endpoints (`/api/v1/barbers`). */
@Service()
export class BarbersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/barbers';

  /** Public directory (id + name) consumed by the guest booking wizard. */
  readonly publicListUrl = this.base;

  /** Administrative directory including contact details. */
  readonly adminListUrl = `${this.base}/admin`;

  /** Resource URL for a barber's time-off entries. */
  timeOffUrl(barberId: number): string {
    return `${this.base}/${barberId}/time-off`;
  }

  /** Resource URL for a barber's weekly schedule. */
  scheduleUrl(barberId: number): string {
    return `${this.base}/${barberId}/schedule`;
  }

  createBarber(request: BarberRequest): Observable<Barber> {
    return defer(() => {
      const validated = parseRequest(barberSchema, request);
      return this.http
        .post<Barber>(this.base, validated)
        .pipe(map((raw) => parseResponse(barberResponseSchema, raw, 'POST /api/v1/barbers')));
    });
  }

  addTimeOff(barberId: number, request: BarberTimeOffRequest): Observable<BarberTimeOff> {
    return defer(() => {
      const validated = parseRequest(barberTimeOffSchema, request);
      return this.http.post<BarberTimeOff>(this.timeOffUrl(barberId), validated);
    });
  }

  previewSchedule(
    barberId: number,
    request: ScheduleChangeRequest,
  ): Observable<SchedulePreviewResponse> {
    return defer(() => {
      const validated = parseRequest(scheduleChangeRequestSchema, request);
      return this.http
        .post<SchedulePreviewResponse>(`${this.scheduleUrl(barberId)}/preview`, validated)
        .pipe(
          map((raw) =>
            parseResponse(
              schedulePreviewResponseSchema,
              raw,
              'POST /api/v1/barbers/{id}/schedule/preview',
            ),
          ),
        );
    });
  }

  updateSchedule(
    barberId: number,
    request: ScheduleChangeRequest,
  ): Observable<BarberScheduleResponse> {
    return defer(() => {
      const validated = parseRequest(scheduleChangeRequestSchema, request);
      return this.http
        .put<BarberScheduleResponse>(this.scheduleUrl(barberId), validated)
        .pipe(
          map((raw) =>
            parseResponse(barberScheduleResponseSchema, raw, 'PUT /api/v1/barbers/{id}/schedule'),
          ),
        );
    });
  }
}
