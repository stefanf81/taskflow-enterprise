import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from './appointments';
import {
  AppointmentCreateRequest,
  AppointmentUpdateRequest,
  GuestRescheduleRequest,
} from '../../types/api';
import { invalidateBookingQueries, queryKeys } from '../../query/queryKeys';

export const useAppointments = (
  filter?: string,
  search?: string,
  page = 0,
  size = 10,
  { subscribed = true }: { subscribed?: boolean } = {},
) => {
  return useQuery({
    queryKey: queryKeys.appointments.list(filter, search, page, size),
    queryFn: ({ signal }) =>
      appointmentsApi.getAllAppointments(filter, search, page, size, { signal }),
    staleTime: 10000,
    // Keep the current page on screen while another page, filter or search term loads.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    // Hidden tabs neither fetch on invalidation nor re-render on cache updates.
    subscribed,
  });
};

/**
 * `enabled: false` keeps the query idle while its caller does not show the slots yet (the booking
 * wizard before its date/time step), so a selection change there does not fire a request.
 */
export const useBusySlots = (
  barberName: string,
  bookingDate: string,
  serviceType?: string,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  return useQuery({
    queryKey: queryKeys.busySlots.forDay(barberName, bookingDate, serviceType ?? ''),
    // No placeholderData: another barber's or day's busy slots must never be shown as this one's.
    queryFn: ({ signal }) =>
      appointmentsApi.getBusySlots(barberName, bookingDate, serviceType, { signal }),
    enabled: enabled && !!barberName && !!bookingDate,
    staleTime: 5000,
    refetchOnWindowFocus: true,
  });
};

/**
 * The start times one booking cannot move to on `bookingDate`: its own barber and booked length,
 * the booking itself not counted. A guest passes the email the booking was made with.
 */
export const useRescheduleAvailability = (
  publicId: string,
  bookingDate: string,
  email?: string | null,
) => {
  return useQuery({
    queryKey: queryKeys.busySlots.forMove(publicId, bookingDate, email ?? ''),
    queryFn: ({ signal }) =>
      email
        ? appointmentsApi.publicRescheduleAvailability(publicId, email, bookingDate, { signal })
        : appointmentsApi.customerRescheduleAvailability(publicId, bookingDate, { signal }),
    enabled: !!publicId && !!bookingDate,
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

/** A guest moves a booking (verified by its code and email); approval starts again. */
export const usePublicRescheduleAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ publicId, ...request }: { publicId: string } & GuestRescheduleRequest) =>
      appointmentsApi.publicRescheduleAppointment(publicId, request),
    // The old slot is free again and the new one taken.
    onSuccess: () => invalidateBookingQueries(queryClient),
  });
};
