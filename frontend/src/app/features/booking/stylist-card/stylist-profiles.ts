import { BarberRating, PublicBarber } from '../../../types/api';
import { StylistProfile } from './stylist-card';

/**
 * Optional display metadata for seeded barbers (role copy and badges).
 *
 * The roster itself comes from the API (PublicBarberStore) — this map only
 * decorates known display names and falls back to neutral copy for any other
 * barber, so adding/removing barbers never requires a code change.
 */
const BARBER_PRESENTATION: Record<string, { title: string; specialty: string; badge?: string }> = {
  'Alex the Barber': {
    title: 'Master Stylist',
    specialty: 'Classic Scissor Cuts',
    badge: 'Top Rated',
  },
  'Sara the Stylist': {
    title: 'Skin Fade Expert',
    specialty: 'Skin Fades & Tapers',
    badge: 'Featured',
  },
  'Marcus Master Blade': {
    title: 'Director Barber',
    specialty: 'Razor Shaves & Beards',
    badge: 'Master Barber',
  },
};

export type RatingsDisplayState = 'loading' | 'error' | 'ready';

/** Joins the public roster with the public ratings into the wizard's stylist cards. */
export function toStylistProfiles(
  barbers: readonly PublicBarber[],
  ratings: readonly BarberRating[],
  ratingsState: RatingsDisplayState = 'ready',
): StylistProfile[] {
  return barbers.map((barber) => {
    const presentation = BARBER_PRESENTATION[barber.name];
    const rating = ratings.find((r) => r.barberName === barber.name);
    let ratingLabel = '—';
    let reviewsLabel = 'New';
    if (ratingsState === 'loading' && !rating) {
      ratingLabel = '…';
      reviewsLabel = 'Loading';
    } else if (ratingsState === 'error' && !rating) {
      ratingLabel = '—';
      reviewsLabel = 'Unavailable';
    } else if (rating && rating.reviewCount > 0) {
      ratingLabel = `${rating.averageRating.toFixed(1)} ★`;
      reviewsLabel = `${rating.reviewCount} reviews`;
    }
    return {
      name: barber.name,
      title: presentation?.title ?? 'Professional Barber',
      specialty: presentation?.specialty ?? 'All grooming services',
      ...(presentation?.badge ? { badge: presentation.badge } : {}),
      rating: ratingLabel,
      reviews: reviewsLabel,
    };
  });
}
