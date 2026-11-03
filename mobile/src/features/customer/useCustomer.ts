import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerApi } from './customer';
import { invalidateBookingQueries, queryKeys } from '../../query/queryKeys';

export const useCustomerAppointments = (page = 0, size = 10) => {
  return useQuery({
    queryKey: queryKeys.customerAppointments.page(page, size),
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
    // The cancelled slot is free again, and the admin list changed too.
    onSuccess: () => invalidateBookingQueries(queryClient),
  });
};
