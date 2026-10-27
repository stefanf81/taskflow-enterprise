import { useQuery } from '@tanstack/react-query';
import { appointmentsApi } from '../../core/appointments/appointments';

/**
 * IANA time zone of the shop, or null until it is known (or when it cannot be loaded, in which
 * case the phone's own clock is used and the server stays authoritative). It changes only with a
 * deployment, so it is fetched once and kept for the session.
 */
export function useShopTimeZone(): string | null {
  const { data } = useQuery({
    queryKey: ['shopTimeZone'],
    queryFn: appointmentsApi.getShopTimeZone,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}
