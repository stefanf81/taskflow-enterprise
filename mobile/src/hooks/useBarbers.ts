import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { barbersApi } from '../api/barbers';
import { BarberTimeOffRequest } from '../types/api';

export const usePublicBarbers = () => {
  return useQuery({
    queryKey: ['publicBarbers'],
    queryFn: () => barbersApi.getPublicBarbers(),
    staleTime: 60000,
  });
};

export const useAdminBarbers = () => {
  return useQuery({
    queryKey: ['adminBarbers'],
    queryFn: () => barbersApi.getAdminBarbers(),
    staleTime: 60000,
  });
};

export const useBarberTimeOff = (barberId: number | null) => {
  return useQuery({
    queryKey: ['barberTimeOff', barberId],
    queryFn: () => (barberId ? barbersApi.getTimeOff(barberId) : Promise.resolve([])),
    enabled: barberId !== null,
  });
};

export const useAddTimeOff = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ barberId, data }: {
      barberId: number;
      data: BarberTimeOffRequest;
    }) => barbersApi.addTimeOff(barberId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['barberTimeOff', variables.barberId] });
    },
  });
};
