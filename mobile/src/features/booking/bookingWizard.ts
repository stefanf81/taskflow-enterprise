import { AppointmentCreateRequest, ServiceItem } from '../../types/api';
import {
  DEFAULT_TIME_SLOTS,
  getFirstSelectableSlot,
  getSlotValidationError,
  getUpcomingDays,
  isSlotInPast,
  SlotSelection,
  UpcomingDay,
} from '../../utils/time-utils';

/**
 * Pure building blocks of the booking wizard: step rules, the default selection, filtering and
 * the request payload. No React and no clock of their own (`now` is passed in), so they are
 * deterministic in tests and the date rules can move with the time helpers.
 */

/** Input-only sentinel (ADR-014): the backend resolves it to a concrete barber. */
export const NO_PREFERENCE_BARBER = 'No Preference (First Available)';

/** Treatment → Stylist → Date/Slot → Contact. */
export type BookingStep = 1 | 2 | 3 | 4;
export const BOOKING_STEPS: readonly BookingStep[] = [1, 2, 3, 4];
/** The first step that shows the busy slots, so the first one that needs them. */
export const DATE_TIME_STEP: BookingStep = 3;

/** Destination after the booking receipt closes.
 *
 * BookingScreen is mounted in BOTH the guest tab navigator (route 'Booking',
 * sibling 'Home') and the customer tab navigator (route 'NewBooking', no
 * 'Home' route). Navigating to 'Home' from the customer flow would crash with
 * "action 'NAVIGATE' with name 'Home' was not handled". Pure helper — the
 * current tab navigator's route names decide the target.
 */
export const getPostBookingDestination = (
  routeNames: readonly string[],
): 'Home' | 'CustomerAppointments' =>
  routeNames.includes('Home') ? 'Home' : 'CustomerAppointments';

/** Services of `category` ('all' for every one) whose name or description contains `query`. */
export function filterServices(
  services: readonly ServiceItem[],
  category: string,
  query: string,
): readonly ServiceItem[] {
  let list = services;
  if (category !== 'all') {
    list = list.filter((s) => s.category === category);
  }
  const needle = query.trim().toLowerCase();
  if (needle) {
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle),
    );
  }
  return list;
}

/**
 * The days offered for the shop-calendar date `todayKey` (`YYYY-MM-DD`). The list only depends on
 * the date, not on the minute, so it is built from the key, at noon (clear of DST shifts).
 */
export function getBookingDays(todayKey: string): UpcomingDay[] {
  const [year = 0, month = 1, day = 1] = todayKey.split('-').map(Number);
  return getUpcomingDays(new Date(year, month - 1, day, 12));
}

/**
 * The first bookable slot of `dates`; when none is left, the first offered day and slot (the
 * date/time step then explains why it cannot be booked).
 */
export function getDefaultSlot(dates: readonly string[], now: Date): SlotSelection {
  const first = getFirstSelectableSlot(dates, now);
  return {
    date: first?.date ?? dates[0] ?? '',
    time: first?.time ?? DEFAULT_TIME_SLOTS[0] ?? '',
  };
}

/** Slots of `date` that already started (shown disabled in the picker). */
export function getPastSlots(date: string, now: Date): string[] {
  return DEFAULT_TIME_SLOTS.filter((slot) => isSlotInPast(date, slot, now));
}

/** What the busy-slots lookup currently knows about the selected day. */
export interface SlotAvailability {
  busySlots: readonly string[];
  isChecking: boolean;
  isFailed: boolean;
}

/**
 * Why the date/time step cannot be left, or null. Pass the clock as of the Continue tap: the slot
 * may have passed since the last re-render. While the lookup runs, `busySlots` is still empty (or
 * the previous date's list): unknown availability must never be treated as "all free".
 */
export function getDateTimeStepError(
  date: string,
  time: string,
  now: Date,
  availability: SlotAvailability,
): string | null {
  const slotError = getSlotValidationError(date, time, now);
  if (slotError) return slotError;
  if (availability.isChecking) return 'Still checking availability. Please wait a moment.';
  if (availability.isFailed) return 'Could not check availability. Retry before continuing.';
  if (availability.busySlots.includes(time)) {
    return 'The selected time slot is already booked. Please choose another.';
  }
  return null;
}

export interface ContactDetails {
  name: string;
  email: string;
  phone: string;
}

export const EMPTY_CONTACT: ContactDetails = { name: '', email: '', phone: '' };

export function getContactError(contact: ContactDetails): string | null {
  return contact.name.trim() && contact.email.trim() && contact.phone.trim()
    ? null
    : 'Please fill in all customer contact fields.';
}

/** What the reservation summary shows; `durationMinutes` is undefined for an unknown service. */
export interface BookingSummary {
  service: string;
  durationMinutes: number | undefined;
  barber: string;
  date: string;
  time: string;
  estimatedEnd: string;
  total: number;
}

export interface BookingSelection {
  barber: string;
  date: string;
  time: string;
  service: string;
}

/** The create request. Its JSON is also the idempotency signature, so keep the field order. */
export function buildBookingPayload(
  contact: ContactDetails,
  selection: BookingSelection,
): AppointmentCreateRequest {
  return {
    customerName: contact.name.trim(),
    customerEmail: contact.email.trim(),
    customerPhone: contact.phone.trim(),
    barberName: selection.barber,
    bookingDate: selection.date,
    bookingTime: selection.time,
    serviceType: selection.service,
  };
}
