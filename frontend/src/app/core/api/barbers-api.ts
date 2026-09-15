import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, Observable } from 'rxjs';
import { BarberTimeOff, BarberTimeOffRequest } from '../../types/api';
import { parseRequest } from './request-validation';
import { barberTimeOffSchema } from '@taskflow/schemas';

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

  addTimeOff(barberId: number, request: BarberTimeOffRequest): Observable<BarberTimeOff> {
    return defer(() => {
      const validated = parseRequest(barberTimeOffSchema, request);
      return this.http.post<BarberTimeOff>(this.timeOffUrl(barberId), validated);
    });
  }
}
