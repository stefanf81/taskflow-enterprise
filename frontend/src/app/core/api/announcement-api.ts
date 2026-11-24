import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import {
  announcementResponseSchema,
  announcementSchema,
  AnnouncementRequest,
  AnnouncementResponse,
} from '@taskflow/schemas';
import { parseRequest, parseResponse } from './request-validation';

/**
 * The owner's edit of the landing pages' promo strip (`PUT /api/v1/catalog/announcement`). Guests
 * read the strip from the shop info ({@link ShopClock.announcement}); only the admin dashboard uses
 * this client, so it stays out of main.js.
 */
@Service()
export class AnnouncementApi {
  private readonly http = inject(HttpClient);

  updateAnnouncement(request: AnnouncementRequest): Observable<AnnouncementResponse> {
    return defer(() =>
      this.http.put<unknown>(
        '/api/v1/catalog/announcement',
        parseRequest(announcementSchema, request),
      ),
    ).pipe(
      map((raw) =>
        parseResponse(announcementResponseSchema, raw, 'PUT /api/v1/catalog/announcement'),
      ),
    );
  }
}
