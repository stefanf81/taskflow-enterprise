/**
 * Appointment lifecycle states as the backend reports them.
 *
 * `CANCELLED` is a terminal state (customer cancellation, or the shop's time-off
 * cancelling a conflicting booking): it can be neither approved, denied nor
 * cancelled again. The response schema keeps `status` a plain string so a state
 * added server-side later still renders instead of failing validation.
 */
export type AppointmentStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';

/** Human label for a status badge ("CANCELLED" -> "Cancelled"); unknown values are title-cased. */
export function statusLabel(status: string): string {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

/** Whether a customer may still cancel a booking in this state. */
export function isCustomerCancellable(status: string): boolean {
  return status === 'PENDING' || status === 'APPROVED';
}
