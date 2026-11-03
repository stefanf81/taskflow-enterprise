import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from './appointments';
import { AppointmentCreateRequest, AppointmentUpdateRequest } from '../../types/api';
import { invalidateBookingQueries, queryKeys } from '../../query/queryKeys';

export const useAppointments = (filter?: string, search?: string, page = 0, size = 10) => {
  return useQuery({
    queryKey: queryKeys.appointments.list(filter, search, page, size),
    queryFn: ({ signal }) =>
      appointmentsApi.getAllAppointments(filter, search, page, size, { signal }),
    staleTime: 10000,
    // Keep the current page on screen while another page, filter or search term loads.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
};

export const useBusySlots = (barberName: string, bookingDate: string, serviceType?: string) => {
  return useQuery({
    queryKey: queryKeys.busySlots.forDay(barberName, bookingDate, serviceType ?? ''),
    // No placeholderData: another barber's or day's busy slots must never be shown as this one's.
    queryFn: ({ signal }) =>
      appointmentsApi.getBusySlots(barberName, bookingDate, serviceType, { signal }),
    enabled: !!barberName && barberName.length > 0 && !!bookingDate,
    staleTime: 5000,
    refetchOnWindowFocus: true,
  });
};

export const useCreateAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: AppointmentCreateRequest;
      idempotencyKey?: string;
    }) => appointmentsApi.createAppointment(data, idempotencyKey),
    onSuccess: () => invalidateBookingQueries(queryClient),
  });
};

export const useUpdateAppointmentStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: AppointmentUpdateRequest['status'] }) =>
      appointmentsApi.updateAppointmentStatus(id, status),
    onSuccess: () => invalidateBookingQueries(queryClient),
  });
};

export const useDeleteAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => appointmentsApi.deleteAppointment(id),
    onSuccess: () => invalidateBookingQueries(queryClient),
  });
};

export const usePublicCancelAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ publicId, email }: { publicId: string; email: string }) =>
      appointmentsApi.publicCancelAppointment(publicId, email),
    onSuccess: () => invalidateBookingQueries(queryClient),
  });
};
