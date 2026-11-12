import { type WallClock, isSlotInPast } from './time';

/**
 * The "any barber" choice. Sent as the barber name; the server resolves it to a real barber inside
 * the booking transaction and never stores it (ADR-014).
 */
export const NO_PREFERENCE_BARBER = 'No Preference (First Available)';

/** Statuses a customer or guest may still cancel; DENIED and CANCELLED are final. */
export const CANCELLABLE_STATUSES: readonly string[] = ['PENDING', 'APPROVED'];

/**
 * Whether a customer may still cancel a booking online, mirroring the server: it is PENDING or
 * APPROVED and has not started yet at `now` (the shop's wall clock). An unknown status added
 * server-side later is not cancellable until this list knows it.
 */
export function isCustomerCancellable(
  booking: { status: string; bookingDate: string; bookingTime: string },
  now: WallClock,
): boolean {
  return (
    CANCELLABLE_STATUSES.includes(booking.status.toUpperCase()) &&
    !isSlotInPast(booking.bookingDate, booking.bookingTime, now)
  );
}

/**
 * Booking references are lowercase UUIDs and the server looks them up by exact match, so anything
 * typed or pasted is trimmed and lower-cased first.
 */
export function normalizePublicId(value: string): string {
  return value.trim().toLowerCase();
}
