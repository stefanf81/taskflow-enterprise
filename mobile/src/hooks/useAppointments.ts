import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '../api/appointments';
import { AppointmentCreateRequest, AppointmentUpdateRequest } from '../types/api';

export const useAppointments = (filter?: string, search?: string, page = 0, size = 10) => {
  return useQuery({
    queryKey: ['appointments', filter, search, page, size],
    queryFn: () => appointmentsApi.getAllAppointments(filter, search, page, size),
    staleTime: 10000,
  });
};

export const useBusySlots = (barberName: string, bookingDate: string) => {
  return useQuery({
    queryKey: ['busySlots', barberName, bookingDate],
    queryFn: () => appointmentsApi.getBusySlots(barberName, bookingDate),
    enabled: !!barberName && barberName.length > 0 && !!bookingDate,
    staleTime: 5000,
  });
};

export const useCreateAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AppointmentCreateRequest) => appointmentsApi.createAppointment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['busySlots'] });
    },
  });
};

export const useUpdateAppointmentStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: AppointmentUpdateRequest['status'] }) =>
      appointmentsApi.updateAppointmentStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
};

export const useDeleteAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => appointmentsApi.deleteAppointment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
};

export const usePublicCancelAppointment = () => {
  return useMutation({
    mutationFn: ({ publicId, email }: { publicId: string; email: string }) =>
      appointmentsApi.publicCancelAppointment(publicId, email),
  });
};
