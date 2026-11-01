import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewsApi } from './reviews';
import { ReviewRequest } from '../../types/api';

export const useBarberRatings = () => {
  return useQuery({
    queryKey: ['barberRatings'],
    queryFn: ({ signal }) => reviewsApi.getBarberRatings({ signal }),
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
