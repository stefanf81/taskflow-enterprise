import {
  array,
  email,
  enum as zEnum,
  maxLength,
  minLength,
  number,
  object,
  optional,
  refine,
  regex,
  string,
  trim,
  type infer as zInfer,
} from "zod/mini";
import { omittedAsEmptyString } from "./catalog";

const dateSchema = string().check(regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format"));
const timeSchema = string().check(
  regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Booking time must be in 24h HH:mm format"),
);

export const appointmentCreateSchema = object({
  customerName: string().check(trim(), minLength(1, "Customer name is required"), maxLength(100)),
  customerEmail: string().check(
    trim(),
    minLength(1, "Customer email is required"),
    email("Invalid email format"),
    maxLength(100),
  ),
  customerPhone: string().check(trim(), minLength(1, "Customer phone is required"), maxLength(50)),
  barberName: string().check(trim(), minLength(1, "Barber name is required"), maxLength(100)),
  bookingDate: dateSchema,
  bookingTime: timeSchema,
  serviceType: string().check(trim(), minLength(1, "Service type is required"), maxLength(100)),
});

export type AppointmentCreateRequest = zInfer<typeof appointmentCreateSchema>;

export const appointmentUpdateSchema = object({
  status: zEnum(["APPROVED", "DENIED"], {
    error: "Status must be APPROVED or DENIED",
  }),
});

export type AppointmentUpdateRequest = zInfer<typeof appointmentUpdateSchema>;

export const barberTimeOffSchema = object({
  startDate: dateSchema,
  endDate: dateSchema,
  reason: optional(string().check(maxLength(255, "Reason must be at most 255 characters"))),
}).check(
  refine(({ startDate, endDate }) => endDate >= startDate, {
    path: ["endDate"],
    message: "End date must not be before start date",
  }),
);

export type BarberTimeOffRequest = zInfer<typeof barberTimeOffSchema>;

/** GET appointment response item. */
export const appointmentResponseSchema = object({
  id: number(),
  publicId: string(),
  customerName: string(),
  customerEmail: string(),
  customerPhone: string(),
  barberName: string(),
  bookingDate: string(),
  bookingTime: string(),
  serviceType: string(),
  status: string(),
  createdAt: string(),
  updatedAt: string(),
});

export type AppointmentResponse = zInfer<typeof appointmentResponseSchema>;

/** GET /api/v1/appointments/public/busy-slots response (HH:mm strings). */
export const busySlotsResponseSchema = array(string());

/** GET /api/v1/appointments/public/shop response: the IANA time zone every booking is read in. */
export const shopInfoResponseSchema = object({
  timeZone: string().check(minLength(1)),
});

export type ShopInfoResponse = zInfer<typeof shopInfoResponseSchema>;

export const pageMetadataSchema = object({
  number: number(),
  size: number(),
  totalElements: number(),
  totalPages: number(),
});

export const pagedAppointmentResponseSchema = object({
  content: array(appointmentResponseSchema),
  page: pageMetadataSchema,
});

export const appointmentStatsSchema = object({
  total: number(),
  pending: number(),
  approved: number(),
  denied: number(),
  overdue: number(),
  progress: number(),
  approvedRevenue: number(),
});

/** GET /api/v1/appointments dashboard payload. */
export const appointmentDashboardResponseSchema = object({
  page: pagedAppointmentResponseSchema,
  stats: appointmentStatsSchema,
});

/** GET /api/v1/notifications response item. */
export const notificationOutboxResponseSchema = object({
  id: number(),
  message: string(),
  recipient: string(),
  retryCount: number(),
  // Unsent notifications have no timestamp/type yet (omitted, not null).
  sentAt: omittedAsEmptyString(),
  status: string(),
  type: omittedAsEmptyString(),
});

/** GET /api/v1/notifications response. */
export const notificationOutboxResponseListSchema = array(notificationOutboxResponseSchema);

/** Server-sent appointment event payload. */
export const appointmentEventSchema = object({
  type: zEnum(["CREATED", "UPDATED", "DELETED"]),
  appointmentId: number(),
  occurredAt: string(),
});

export type AppointmentEventPayload = zInfer<typeof appointmentEventSchema>;

/** GET /api/v1/barbers/{id}/time-off response item. */
export const barberTimeOffResponseSchema = object({
  id: number(),
  startDate: string(),
  endDate: string(),
  reason: omittedAsEmptyString(),
});

export type BarberTimeOffResponse = zInfer<typeof barberTimeOffResponseSchema>;

/** GET /api/v1/barbers/{id}/time-off response. */
export const barberTimeOffResponseListSchema = array(barberTimeOffResponseSchema);
