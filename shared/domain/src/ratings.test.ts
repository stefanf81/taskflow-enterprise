import { describe, expect, it } from 'vitest';
import { formatRating, summarizeShopRatings } from './ratings';

describe('summarizeShopRatings', () => {
  it('is null when nobody has a review', () => {
    expect(summarizeShopRatings([])).toBeNull();
    expect(
      summarizeShopRatings([{ barberName: 'New Barber', averageRating: 0, reviewCount: 0 }]),
    ).toBeNull();
  });

  it('weights each barber by review count and ignores barbers without reviews', () => {
    const summary = summarizeShopRatings([
      { barberName: 'A', averageRating: 4, reviewCount: 1 },
      { barberName: 'B', averageRating: 5, reviewCount: 3 },
      { barberName: 'C', averageRating: 0, reviewCount: 0 },
    ]);
    expect(summary?.averageRating).toBe(4.75);
    expect(summary?.reviewCount).toBe(4);
    expect(summary?.topBarber.barberName).toBe('B');
  });

  it('breaks a tie on the average by the larger number of reviews', () => {
    const summary = summarizeShopRatings([
      { barberName: 'Few', averageRating: 5, reviewCount: 2 },
      { barberName: 'Many', averageRating: 5, reviewCount: 9 },
    ]);
    expect(summary?.topBarber.barberName).toBe('Many');
  });
});

describe('formatRating', () => {
  it('shows one decimal', () => {
    expect(formatRating(4.875)).toBe('4.9');
    expect(formatRating(5)).toBe('5.0');
  });
});
