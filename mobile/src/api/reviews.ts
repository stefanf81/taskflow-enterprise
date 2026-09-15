import { apiClient } from './client';
import { BarberRating, ReviewRequest } from '../types/api';
import { parseContract } from './contracts';
import { barberRatingResponseSchema, reviewSchema } from '@taskflow/schemas';

export const reviewsApi = {
  getBarberRatings: async (): Promise<BarberRating[]> => {
    const response = await apiClient.get<BarberRating[]>('/api/v1/reviews/public/barber-ratings');
    return parseContract(
      barberRatingResponseSchema.array(),
      response.data,
      'GET /api/v1/reviews/public/barber-ratings',
    );
  },

  submitReview: async (publicId: string, data: ReviewRequest): Promise<void> => {
    const payload = parseContract(reviewSchema, data, 'POST /api/v1/reviews/public');
    await apiClient.post(`/api/v1/reviews/public/${publicId}`, payload);
  },
};
