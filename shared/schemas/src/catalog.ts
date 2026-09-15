import { literal, number, object, string, type infer as zInfer } from "zod";

export const serviceItemSchema = object({
  name: string().trim().min(1, "Service name is required"),
  price: number().positive("Price must be positive"),
  durationMinutes: number().int().positive("Duration must be positive"),
  category: string().trim().min(1, "Category is required"),
  description: string().optional(),
});

export type ServiceItemRequest = zInfer<typeof serviceItemSchema>;

export const barberSchema = object({
  name: string().trim().min(1, "Barber name is required").max(100),
  email: string()
    .email("Email must be valid")
    .max(100)
    .or(literal(""))
    .optional(),
  phone: string().max(50, "Phone must be at most 50 characters").optional(),
});

export type BarberRequest = zInfer<typeof barberSchema>;

/** GET /api/v1/catalog response item. */
export const serviceItemResponseSchema = object({
  id: number(),
  name: string(),
  price: number(),
  durationMinutes: number(),
  category: string(),
  // The backend omits null/empty descriptions (NON_NULL Jackson inclusion).
  description: string().nullish().transform((value) => value ?? ''),
});

export type ServiceItemResponse = zInfer<typeof serviceItemResponseSchema>;

/** GET /api/v1/barbers response item (public directory). */
export const publicBarberResponseSchema = object({
  id: number(),
  name: string(),
});

export type PublicBarberResponse = zInfer<typeof publicBarberResponseSchema>;

/** GET /api/v1/barbers/admin response item. */
export const barberResponseSchema = object({
  id: number(),
  name: string(),
  // Contact details are optional in the backend projection and may be omitted.
  email: string().nullish().transform((value) => value ?? ''),
  phone: string().nullish().transform((value) => value ?? ''),
});

export type BarberResponse = zInfer<typeof barberResponseSchema>;
