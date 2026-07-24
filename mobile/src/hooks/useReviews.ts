import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewsApi } from '../api/reviews';
import { ReviewRequest } from '../types/api';

export const useBarberRatings = () => {
  return useQuery({
    queryKey: ['barberRatings'],
    queryFn: () => reviewsApi.getBarberRatings(),
    staleTime: 30000,
  });
};

export const useSubmitReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ publicId, data }: { publicId: string; data: ReviewRequest }) =>
      reviewsApi.submitReview(publicId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barberRatings'] });
    },
  });
};
