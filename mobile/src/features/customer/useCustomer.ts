import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerApi } from './customer';

export const useCustomerAppointments = (page = 0, size = 10) => {
  return useQuery({
    queryKey: ['customerAppointments', page, size],
    queryFn: ({ signal }) => customerApi.getAppointments(page, size, { signal }),
    staleTime: 10000,
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
};

export const useCancelCustomerAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicId: string) => customerApi.cancelAppointment(publicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customerAppointments'] });
    },
  });
};
