/**
 * `GET /api/v1/appointments/public/shop`: the shop's time zone, opening hours and booking window.
 * A module of its own so {@link ShopClock}, which the landing page needs at boot, does not pull
 * `AppointmentsApi` and the appointment schemas into the initial bundle (BENCHMARKS.md §76).
 */
export const SHOP_INFO_URL = '/api/v1/appointments/public/shop';
