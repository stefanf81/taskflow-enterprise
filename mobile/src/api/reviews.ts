import { apiClient } from './client';
import { BarberRating, ReviewRequest } from '../types/api';

export const reviewsApi = {
  getBarberRatings: async (): Promise<BarberRating[]> => {
    const response = await apiClient.get<BarberRating[]>('/api/v1/reviews/public/barber-ratings');
    return response.data;
  },

  submitReview: async (publicId: string, data: ReviewRequest): Promise<void> => {
    await apiClient.post(`/api/v1/reviews/public/${publicId}`, data);
  },
};
