import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ServiceItem } from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';

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
    return this.http.post<ServiceItem>(`${this.servicesUrl}/${id}/restore`, null);
  }

  getAllServices(): Observable<ServiceItem[]> {
    return this.http.get<ServiceItem[]>(this.servicesUrl, {
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    });
  }
}
