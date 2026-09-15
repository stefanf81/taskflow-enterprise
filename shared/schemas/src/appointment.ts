import { enum as zEnum, number, object, string, type infer as zInfer } from "zod";

const dateSchema = string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  "Date must use YYYY-MM-DD format",
);
const timeSchema = string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  "Booking time must be in 24h HH:mm format",
);

export const appointmentCreateSchema = object({
  customerName: string().trim().min(1, "Customer name is required").max(100),
  customerEmail: string()
    .trim()
    .min(1, "Customer email is required")
    .email("Invalid email format")
    .max(100),
  customerPhone: string().trim().min(1, "Customer phone is required").max(50),
  barberName: string().trim().min(1, "Barber name is required").max(100),
  bookingDate: dateSchema,
  bookingTime: timeSchema,
  serviceType: string().trim().min(1, "Service type is required").max(100),
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
  reason: string().max(255, "Reason must be at most 255 characters").optional(),
}).refine(({ startDate, endDate }) => endDate >= startDate, {
  path: ["endDate"],
  message: "End date must not be before start date",
});

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

export const pageMetadataSchema = object({
  number: number(),
  size: number(),
  totalElements: number(),
  totalPages: number(),
});

export const pagedAppointmentResponseSchema = object({
  content: appointmentResponseSchema.array(),
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
  sentAt: string().nullish().transform((value) => value ?? ''),
  status: string(),
  type: string().nullish().transform((value) => value ?? ''),
});

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
  reason: string().nullish().transform((value) => value ?? ''),
});

export type BarberTimeOffResponse = zInfer<typeof barberTimeOffResponseSchema>;
