/**
 * Structural response contracts generated from api/openapi.json.
 *
 * These describe which fields the backend sends and their primitive types. They are NOT the
 * runtime validators: the hand-written schemas next to this folder add enums, lengths and
 * defaults, and a parity test fails when their field sets differ from these.
 *
 * DO NOT EDIT MANUALLY — run `npm run sync:api-types` to regenerate.
 */
import { array, number, object, optional, string } from "zod/mini";

export const appointmentResponseContract = object({
  barberName: string(),
  bookingDate: string(),
  bookingTime: string(),
  createdAt: string(),
  customerEmail: string(),
  customerName: string(),
  customerPhone: string(),
  id: number(),
  publicId: string(),
  serviceType: string(),
  status: string(),
  updatedAt: string(),
});

export const pageMetadataContract = object({
  number: number(),
  size: number(),
  totalElements: number(),
  totalPages: number(),
});

export const pagedModelAppointmentResponseContract = object({
  content: array(appointmentResponseContract),
  page: pageMetadataContract,
});

export const appointmentStatsContract = object({
  approved: number(),
  approvedRevenue: number(),
  denied: number(),
  overdue: number(),
  pending: number(),
  progress: number(),
  total: number(),
});

export const appointmentDashboardResponseContract = object({
  page: pagedModelAppointmentResponseContract,
  stats: appointmentStatsContract,
});

export const barberRatingResponseContract = object({
  averageRating: number(),
  barberName: string(),
  reviewCount: number(),
});

export const barberResponseContract = object({
  email: optional(string()),
  id: number(),
  name: string(),
  phone: optional(string()),
});

export const barberTimeOffResponseContract = object({
  endDate: string(),
  id: number(),
  reason: optional(string()),
  startDate: string(),
});

export const loginResponseContract = object({
  role: string(),
  username: string(),
});

export const mobileLoginResponseContract = object({
  accessToken: string(),
  expiresIn: number(),
  role: string(),
  tokenType: string(),
  username: string(),
});

export const notificationOutboxResponseContract = object({
  id: number(),
  message: string(),
  recipient: string(),
  retryCount: number(),
  sentAt: optional(string()),
  status: string(),
  type: optional(string()),
});

export const publicBarberResponseContract = object({
  id: number(),
  name: string(),
});

export const registerResponseContract = object({
  message: string(),
});

export const serviceItemResponseContract = object({
  category: string(),
  description: optional(string()),
  durationMinutes: number(),
  id: number(),
  name: string(),
  price: number(),
});

export const shopInfoResponseContract = object({
  timeZone: string(),
});
