import type { QueryClient } from '@tanstack/react-query';
import type {
  AppointmentDashboardResponse,
  AppointmentItem,
  AppointmentPage,
} from '../types/api';

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
  /** The owner's calendar: every booking of one day or week (a plain list, not a page). */
  calendarAppointments: {
    all: ['calendarAppointments'] as const,
    range: (from: string, to: string) => ['calendarAppointments', from, to] as const,
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
  /** Retail products (display only); a root of its own, like the menu. */
  retailProducts: {
    all: ['retailProducts'] as const,
  },
  busySlots: {
    all: ['busySlots'] as const,
    forDay: (barberName: string, bookingDate: string, serviceType: string) =>
      ['busySlots', barberName, bookingDate, serviceType] as const,
    /** What one booking can move to (the guest's email is part of the question). */
    forMove: (publicId: string, bookingDate: string, email: string) =>
      ['busySlots', 'move', publicId, bookingDate, email] as const,
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
export function invalidateBookingQueries(
  queryClient: QueryClient,
  { refetchBusySlots = true }: { refetchBusySlots?: boolean } = {},
): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.calendarAppointments.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.customerAppointments.all });
  if (refetchBusySlots) {
    queryClient.invalidateQueries({ queryKey: queryKeys.busySlots.all });
  } else {
    // Marked stale only: each reloads when it is next shown.
    queryClient.invalidateQueries({ queryKey: queryKeys.busySlots.all, refetchType: 'none' });
  }
}

/** One booking, by its database id (admin endpoints) or its public id (customer endpoints). */
export type BookingRef = { id: number } | { publicId: string };

/**
 * Writes what a booking mutation answered into every cached page of the admin list and of the
 * customer's bookings that shows it: the server's updated booking, or the status a cancellation
 * set (its 204 has no body). Called in the hook's onSuccess, which runs before `mutate` and
 * `mutateAsync` settle, so the row shows its new status in the render that unlocks it. Before,
 * the mutation only invalidated: for one round trip the row showed the old status with its
 * buttons enabled again, and a second tap sent a second request (BENCHMARKS.md §78).
 * Invalidate afterwards: the counts, a status filter and the free slots still need the server.
 */
export function updateCachedBooking(
  queryClient: QueryClient,
  booking: BookingRef,
  changes: Partial<AppointmentItem>,
): void {
  const matches = (item: AppointmentItem) =>
    'id' in booking ? item.id === booking.id : item.publicId === booking.publicId;
  const update = (content: AppointmentItem[]) =>
    content.some(matches)
      ? content.map((item) => (matches(item) ? { ...item, ...changes } : item))
      : content;
  queryClient.setQueriesData<AppointmentDashboardResponse>(
    { queryKey: queryKeys.appointments.all },
    (old) => {
      if (!old) return old;
      const content = update(old.page.content);
      return content === old.page.content ? old : { ...old, page: { ...old.page, content } };
    },
  );
  queryClient.setQueriesData<AppointmentItem[]>(
    { queryKey: queryKeys.calendarAppointments.all },
    (old) => {
      if (!old) return old;
      const content = update(old);
      return content === old ? old : content;
    },
  );
  queryClient.setQueriesData<AppointmentPage>(
    { queryKey: queryKeys.customerAppointments.all },
    (old) => {
      if (!old) return old;
      const content = update(old.content);
      return content === old.content ? old : { ...old, content };
    },
  );
}

/**
 * Roots of the queries that read public endpoints (api/publicEndpoints.ts: sent without a token,
 * so the answer is the same for every user): the shop's hours and booking window, the service
 * menu and retail products, the barbers and their ratings. Everything else is, or may be, the signed-in user's.
 */
const PUBLIC_QUERY_ROOTS: ReadonlySet<unknown> = new Set([
  'shopInfo',
  queryKeys.catalog.all[0],
  queryKeys.retailProducts.all[0],
  'publicBarbers',
  'barberRatings',
]);

/**
 * Drops what belonged to the previous session when one starts or ends: every query except the
 * public reference data, and every mutation. `queryClient.clear()` used to drop the public data
 * too, so each sign-in, sign-out and expiry downloaded the shop, menu, barbers and ratings again
 * while the screens showed their loading state (BENCHMARKS.md §77).
 */
export function clearSessionQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => !PUBLIC_QUERY_ROOTS.has(query.queryKey[0]) });
  queryClient.getMutationCache().clear();
}
