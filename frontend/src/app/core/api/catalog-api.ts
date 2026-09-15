import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ServiceItem } from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';

/** Public service catalog endpoints (`/api/v1/catalog`). */
@Service()
export class CatalogApi {
  private readonly http = inject(HttpClient);

  /** Resource URL for the eager catalog store. */
  readonly servicesUrl = '/api/v1/catalog';

  getAllServices(): Observable<ServiceItem[]> {
    return this.http.get<ServiceItem[]>(this.servicesUrl, {
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    });
  }
}
