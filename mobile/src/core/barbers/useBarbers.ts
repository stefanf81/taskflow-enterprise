import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { barbersApi } from './barbers';
import { BarberRequest, BarberTimeOffRequest, ScheduleChangeRequest } from '../../types/api';
import { invalidateBookingQueries } from '../../query/queryKeys';
import { getHttpStatus } from '../../utils/errors';

export const usePublicBarbers = () => {
  return useQuery({
    queryKey: ['publicBarbers'],
    queryFn: ({ signal }) => barbersApi.getPublicBarbers({ signal }),
    staleTime: 60000,
  });
};

export const useAdminBarbers = () => {
  return useQuery({
    queryKey: ['adminBarbers'],
    queryFn: ({ signal }) => barbersApi.getAdminBarbers({ signal }),
    staleTime: 60000,
  });
};

export const useBarberTimeOff = (barberId: number | null) => {
  return useQuery({
    queryKey: ['barberTimeOff', barberId],
    queryFn: ({ signal }) =>
      barberId ? barbersApi.getTimeOff(barberId, { signal }) : Promise.resolve([]),
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
      // The server cancels the bookings that fall inside the time off.
      invalidateBookingQueries(queryClient);
    },
  });
};

export const useCreateBarber = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BarberRequest) => barbersApi.createBarber(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminBarbers'] });
      queryClient.invalidateQueries({ queryKey: ['publicBarbers'] });
      queryClient.invalidateQueries({ queryKey: ['shopInfo'] });
      invalidateBookingQueries(queryClient);
    },
  });
};

export const useBarberSchedule = (barberId: number | null) => {
  return useQuery({
    queryKey: ['barberSchedule', barberId],
    queryFn: ({ signal }) =>
      barberId
        ? barbersApi.getSchedule(barberId, { signal })
        : Promise.resolve({ days: [], revision: '' }),
    enabled: barberId !== null,
  });
};

/** A 409 means the schedule (or the bookings it affects) changed since it was loaded. */
function reloadScheduleOnConflict(
  queryClient: ReturnType<typeof useQueryClient>,
  error: unknown,
  barberId: number,
) {
  if (getHttpStatus(error) === 409) {
    queryClient.invalidateQueries({ queryKey: ['barberSchedule', barberId] });
  }
}

/** Counts the upcoming bookings a schedule change would cancel; writes nothing. */
export const usePreviewBarberSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ barberId, data }: { barberId: number; data: ScheduleChangeRequest }) =>
      barbersApi.previewSchedule(barberId, data),
    onError: (error, variables) => reloadScheduleOnConflict(queryClient, error, variables.barberId),
  });
};

export const useUpdateBarberSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ barberId, data }: { barberId: number; data: ScheduleChangeRequest }) =>
      barbersApi.updateSchedule(barberId, data),
    onSuccess: (saved, variables) => {
      queryClient.setQueryData(['barberSchedule', variables.barberId], saved);
      // The shop's hours derive from the schedules, and conflicting bookings were cancelled.
      queryClient.invalidateQueries({ queryKey: ['shopInfo'] });
      invalidateBookingQueries(queryClient);
    },
    onError: (error, variables) => reloadScheduleOnConflict(queryClient, error, variables.barberId),
  });
};
