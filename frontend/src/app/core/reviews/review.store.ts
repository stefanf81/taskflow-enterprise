import { Injectable, computed, inject } from '@angular/core';
import { HttpContext, httpResource } from '@angular/common/http';
import { BarberRating } from '../../types/api';
import { ReviewsApi } from '../api/reviews-api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { safeResourceValue } from '../resource-utils';
import { isServerRender } from '../platform';
import { barberRatingResponseListSchema } from '@taskflow/schemas';

/** Shop-wide rating built from the per-barber averages. */
export interface ShopRatingSummary {
  /** Mean of every review, i.e. the barbers' averages weighted by their review counts. */
  averageRating: number;
  reviewCount: number;
  /** Highest average; on a tie the barber with more reviews. */
  topBarber: BarberRating;
}

export function summarizeShopRatings(ratings: readonly BarberRating[]): ShopRatingSummary | null {
  const reviewed = ratings.filter((r) => r.reviewCount > 0);
  const [first, ...rest] = reviewed;
  if (!first) return null;
  let reviewCount = 0;
  let ratingSum = 0;
  let topBarber = first;
  for (const r of reviewed) {
    reviewCount += r.reviewCount;
    ratingSum += r.averageRating * r.reviewCount;
  }
  for (const r of rest) {
    if (
      r.averageRating > topBarber.averageRating ||
      (r.averageRating === topBarber.averageRating && r.reviewCount > topBarber.reviewCount)
    ) {
      topBarber = r;
    }
  }
  return { averageRating: ratingSum / reviewCount, reviewCount, topBarber };
}

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
  /**
   * Whether the request has produced a list. False while prerendering (no request is made) and
   * while the first load is in flight, so the prerendered page and the browser's first render
   * agree; once true, an empty list really means "no reviews yet".
   */
  readonly hasLoaded = computed(() => {
    const status = this.ratingsResource.status();
    return status === 'resolved' || status === 'local';
  });
  /** The shop's rating across every barber, or null when nobody has been reviewed. */
  readonly shopSummary = computed(() => summarizeShopRatings(this.ratings()));
  readonly errorMessage = computed(() => {
    const err = this.ratingsResource.error();
    return err ? 'Could not load barber ratings.' : null;
  });
  readonly status = computed<'loading' | 'error' | 'ready'>(() => {
    if (this.ratingsResource.error()) return 'error';
    if (this.ratingsResource.isLoading()) return 'loading';
    return 'ready';
  });

  loadRatings(): void {
    this.ratingsResource.reload();
  }
}
