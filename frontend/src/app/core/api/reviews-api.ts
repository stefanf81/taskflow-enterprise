import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, Observable } from 'rxjs';
import { ReviewRequest } from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest } from './request-validation';
import { reviewSchema } from '@taskflow/schemas';

/** Public barber ratings and review submission (`/api/v1/reviews`). */
@Service()
export class ReviewsApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/reviews';

  /** Resource URL for the public barber ratings store. */
  readonly ratingsUrl = `${this.base}/public/barber-ratings`;

  submitReview(publicId: string, request: ReviewRequest): Observable<void> {
    return defer(() => {
      const validated = parseRequest(reviewSchema, request);
      return this.http.post<void>(`${this.base}/public/${publicId}`, validated, {
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      });
    });
  }
}
