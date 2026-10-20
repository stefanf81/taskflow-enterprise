import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { BarberRating } from './types/api';
import { ReviewsApi } from './core/api/reviews-api';
import { PUBLIC_REQUEST } from './core/http/public-request.token';
import { safeResourceValue } from './core/resource-utils';
import { isServerRender } from './core/platform';
import { barberRatingResponseListSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly reviewsApi = inject(ReviewsApi);

  // Build-time prerendering has no backend. Idle on the server renders the same empty list the
  // browser shows while the request is in flight, so hydration starts from identical markup.
  private readonly prerendering = isServerRender();
  private readonly ratingsResource = httpResource<BarberRating[]>(
    () =>
      this.prerendering
        ? undefined
        : {
            url: this.reviewsApi.ratingsUrl,
            context: new HttpContext().set(PUBLIC_REQUEST, true),
          },
    {
      defaultValue: [],
      parse: (raw) => barberRatingResponseListSchema.parse(raw),
    },
  );

  /** Error-safe: an empty list (never a throw) while loading or after a failed load. */
  readonly ratings = safeResourceValue<BarberRating[]>(this.ratingsResource, []);
  readonly isLoading = this.ratingsResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.ratingsResource.error();
    return err ? 'Could not load barber ratings.' : null;
  });

  loadRatings(): void {
    this.ratingsResource.reload();
  }
}
