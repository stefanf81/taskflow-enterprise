import React from 'react';
import { ErrorState } from '../../components/common/ErrorState';
import { usePublicBarbers } from '../../core/barbers/useBarbers';
import { StylistCard } from '../booking/StylistCard';
import { HomeSection } from './HomeSection';
import { useBarberRatings } from './useReviews';

// Presentation details the barber directory does not carry, keyed by barber name.
const BARBER_META: Record<string, { title: string; specialty: string; badge?: string }> = {
  'Alex the Barber': { title: 'Master Stylist', specialty: 'Classic Scissor Cuts', badge: 'Top Rated' },
  'Sara the Stylist': { title: 'Skin Fade Expert', specialty: 'Skin Fades & Tapers', badge: 'Featured' },
  'Marcus Master Blade': { title: 'Director Barber', specialty: 'Razor Shaves & Beards', badge: 'Master Barber' },
};

interface MasterStylistsProps {
  onSelectBarber: (barberName: string) => void;
}

/** The live barber roster with review ratings; picking one opens the wizard for that barber. */
export const MasterStylists: React.FC<MasterStylistsProps> = ({ onSelectBarber }) => {
  const { data: ratings = [] } = useBarberRatings();
  // API-driven roster (mirrors the web PublicBarberStore). Empty until the
  // directory loads; never substitute invented names that can drift.
  const { data: barbers = [], isError, refetch } = usePublicBarbers();

  return (
    <HomeSection title="Master Stylists" subtitle="Select a barber or choose first available">
      {isError ? (
        <ErrorState
          title="Stylists Unavailable"
          message="Couldn't load the stylist roster."
          onRetry={() => refetch()}
          testID="master-stylists-error"
        />
      ) : (
        barbers.map((b) => {
          const dbRating = ratings.find((r) => r.barberName === b.name);
          const ratingText = dbRating ? `${dbRating.averageRating.toFixed(1)} ★` : '5.0 ★';
          const reviewsCount = dbRating ? `${dbRating.reviewCount} reviews` : 'New';
          const meta = BARBER_META[b.name] || { title: 'Stylist', specialty: 'Salon Services' };

          return (
            <StylistCard
              key={b.id?.toString() || b.name}
              name={b.name}
              title={meta.title}
              specialty={meta.specialty}
              rating={ratingText}
              reviewsCount={reviewsCount}
              badge={meta.badge}
              onSelect={() => onSelectBarber(b.name)}
            />
          );
        })
      )}
    </HomeSection>
  );
};
