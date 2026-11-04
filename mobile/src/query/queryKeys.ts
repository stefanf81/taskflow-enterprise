import type { QueryClient } from '@tanstack/react-query';

/**
 * Query keys for booking data, which several features read and write. Hooks build their keys
 * here instead of repeating string literals, so a mutation can refresh every view of the same
 * bookings: creating a booking used to refresh the admin list and the free slots but not the
 * customer's My Bookings tab, which stays mounted and kept the old list.
 */
export const queryKeys = {
  appointments: {
    all: ['appointments'] as const,
    list: (filter: string | undefined, search: string | undefined, page: number, size: number) =>
      ['appointments', filter, search, page, size] as const,
  },
  customerAppointments: {
    all: ['customerAppointments'] as const,
    page: (page: number, size: number) => ['customerAppointments', page, size] as const,
  },
  catalog: {
    all: ['catalog'] as const,
    // A separate root: invalidating the public menu must not be the only way to refresh it, and the
    // admin-only retired list must not share a cache entry prefix with it.
    retired: ['retiredServices'] as const,
  },
  busySlots: {
    all: ['busySlots'] as const,
    forDay: (barberName: string, bookingDate: string, serviceType: string) =>
      ['busySlots', barberName, bookingDate, serviceType] as const,
  },
};

/** Marks the public menu and the retired list stale after a service is restored. */
export function invalidateCatalogQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.catalog.retired });
}

/**
 * Marks every cached view of bookings stale (the admin list, the signed-in customer's bookings and
 * the free slots); the ones on screen refetch at once. Not awaited by the callers: a mutation
 * resolves when the server accepted it, not after the lists have been reloaded.
 */
export function invalidateBookingQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.customerAppointments.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.busySlots.all });
}
