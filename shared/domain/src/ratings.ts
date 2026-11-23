/** One barber's rating as `GET /api/v1/reviews/public/barber-ratings` reports it. */
export interface BarberRatingInput {
  barberName: string;
  averageRating: number;
  reviewCount: number;
}

/** Shop-wide rating built from the per-barber averages. */
export interface ShopRatingSummary<T extends BarberRatingInput = BarberRatingInput> {
  /** Mean of every review, i.e. the barbers' averages weighted by their review counts. */
  averageRating: number;
  reviewCount: number;
  /** Highest average; on a tie the barber with more reviews. */
  topBarber: T;
}

/**
 * The shop's rating across every barber (shown on both landing pages instead of a hand-picked
 * testimonial), or null when nobody has been reviewed yet. Barbers without reviews are ignored.
 */
export function summarizeShopRatings<T extends BarberRatingInput>(
  ratings: readonly T[],
): ShopRatingSummary<T> | null {
  const reviewed = ratings.filter((r) => r.reviewCount > 0);
  const [first, ...rest] = reviewed;
  if (!first) return null;
  let reviewCount = 0;
  let ratingSum = 0;
  for (const r of reviewed) {
    reviewCount += r.reviewCount;
    ratingSum += r.averageRating * r.reviewCount;
  }
  let topBarber = first;
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

/** `4.875` -> `4.9`: ratings are shown with one decimal on both clients. */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}
