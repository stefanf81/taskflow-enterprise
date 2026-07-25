import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerApi } from '../api/customer';

export const useCustomerAppointments = (page = 0, size = 10) => {
  return useQuery({
    queryKey: ['customerAppointments', page, size],
    queryFn: () => customerApi.getAppointments(page, size),
    staleTime: 10000,
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
