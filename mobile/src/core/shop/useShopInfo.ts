import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { DEFAULT_SHOP_RULES, type ShopRules } from '@taskflow/domain';
import { appointmentsApi } from '../appointments/appointments';

export interface ShopInfo {
  /** IANA zone of the shop, or null until known (the phone's own clock is used meanwhile). */
  timeZone: string | null;
  /** Booking window and opening hours; the server's built-in defaults until known. */
  rules: ShopRules;
  /** Whether the values came from the server (false while loading or after a failure). */
  loaded: boolean;
}

/**
 * `GET /api/v1/appointments/public/shop`, kept as fresh as the server's own 5-minute
 * `Cache-Control`. Shared with the launch prefetch (core/startup.ts).
 */
export const shopInfoQuery = queryOptions({
  queryKey: ['shopInfo'],
  queryFn: ({ signal }) => appointmentsApi.getShopInfo({ signal }),
  staleTime: 5 * 60_000,
  gcTime: Infinity,
});

/**
 * The shop facts the server decides bookings by (`GET /api/v1/appointments/public/shop`): its time
 * zone, how many days ahead a booking may be made, and its opening hours. Kept as fresh as the
 * server's own 5-minute `Cache-Control`; until it has answered the defaults apply and the server
 * stays authoritative.
 */
export function useShopInfo(): ShopInfo {
  const { data } = useQuery(shopInfoQuery);
  return useMemo<ShopInfo>(
    () =>
      data
        ? {
            timeZone: data.timeZone,
            rules: { maxAdvanceDays: data.maxAdvanceDays, openingHours: data.openingHours },
            loaded: true,
          }
        : { timeZone: null, rules: DEFAULT_SHOP_RULES, loaded: false },
    [data],
  );
}
