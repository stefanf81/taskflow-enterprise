import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import {
  serviceItemSchema,
  serviceItemResponseSchema,
  serviceItemResponseListSchema,
  ServiceItemRequest,
} from '@taskflow/schemas';
import { ServiceItem } from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest, parseResponse } from './request-validation';

/** Service catalog endpoints (`/api/v1/catalog`): the public menu, plus the owner's retired list. */
@Service()
export class CatalogApi {
  private readonly http = inject(HttpClient);

  /** Resource URL for the eager catalog store. */
  readonly servicesUrl = '/api/v1/catalog';

  /** Owner only: services retired because appointments still reference them. */
  readonly retiredUrl = `${this.servicesUrl}/retired`;

  /** Owner only: makes a retired service bookable again. */
  restoreService(id: number): Observable<ServiceItem> {
    return defer(() => this.http.post<unknown>(`${this.servicesUrl}/${id}/restore`, null)).pipe(
      map((raw) =>
        parseResponse(serviceItemResponseSchema, raw, 'POST /api/v1/catalog/{id}/restore'),
      ),
    );
  }

  createService(request: ServiceItemRequest): Observable<ServiceItem> {
    return defer(() =>
      this.http.post<unknown>(this.servicesUrl, parseRequest(serviceItemSchema, request)),
    ).pipe(map((raw) => parseResponse(serviceItemResponseSchema, raw, 'POST /api/v1/catalog')));
  }

  updateService(id: number, request: ServiceItemRequest): Observable<ServiceItem> {
    return defer(() =>
      this.http.put<unknown>(`${this.servicesUrl}/${id}`, parseRequest(serviceItemSchema, request)),
    ).pipe(map((raw) => parseResponse(serviceItemResponseSchema, raw, 'PUT /api/v1/catalog/{id}')));
  }

  retireService(id: number): Observable<void> {
    return defer(() => this.http.delete<void>(`${this.servicesUrl}/${id}`));
  }

  getAllServices(): Observable<ServiceItem[]> {
    return defer(() =>
      this.http.get<unknown>(this.servicesUrl, {
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      }),
    ).pipe(map((raw) => parseResponse(serviceItemResponseListSchema, raw, 'GET /api/v1/catalog')));
  }
}
