import { z } from "zod";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format");
const timeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    "Booking time must be in 24h HH:mm format",
  );

export const appointmentCreateSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required").max(100),
  customerEmail: z
    .string()
    .trim()
    .min(1, "Customer email is required")
    .email("Invalid email format")
    .max(100),
  customerPhone: z.string().trim().min(1, "Customer phone is required").max(50),
  barberName: z.string().trim().min(1, "Barber name is required").max(100),
  bookingDate: dateSchema,
  bookingTime: timeSchema,
  serviceType: z.string().trim().min(1, "Service type is required").max(100),
});

export type AppointmentCreateRequest = z.infer<typeof appointmentCreateSchema>;

export const appointmentUpdateSchema = z.object({
  status: z.enum(["APPROVED", "DENIED"], {
    error: "Status must be APPROVED or DENIED",
  }),
});

export type AppointmentUpdateRequest = z.infer<typeof appointmentUpdateSchema>;

export const barberTimeOffSchema = z
  .object({
    startDate: dateSchema,
    endDate: dateSchema,
    reason: z
      .string()
      .max(255, "Reason must be at most 255 characters")
      .optional(),
  })
  .refine(({ startDate, endDate }) => endDate >= startDate, {
    path: ["endDate"],
    message: "End date must not be before start date",
  });

export type BarberTimeOffRequest = z.infer<typeof barberTimeOffSchema>;
