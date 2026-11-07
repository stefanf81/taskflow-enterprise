import {
  array,
  email,
  int,
  literal,
  maxLength,
  maximum,
  minLength,
  multipleOf,
  nullish,
  number,
  object,
  optional,
  pipe,
  positive,
  string,
  transform,
  trim,
  union,
  type infer as zInfer,
} from "zod/mini";

/** A string field the backend omits when null/empty (NON_NULL Jackson inclusion), read as "". */
export const omittedAsEmptyString = () => pipe(nullish(string()), transform((value) => value ?? ""));

export const serviceItemSchema = object({
  name: string().check(trim(), minLength(1, "Service name is required"), maxLength(100, "Service name must not exceed 100 characters")),
  price: number().check(positive("Price must be positive"), maximum(99999999.99, "Price must have at most 8 integer digits and 2 decimals"), multipleOf(0.01, "Price must have at most 8 integer digits and 2 decimals")),
  durationMinutes: int().check(positive("Duration must be positive"), maximum(2147483647, "Duration is too large")),
  category: string().check(trim(), minLength(1, "Category is required"), maxLength(50, "Category must not exceed 50 characters")),
  description: optional(string().check(maxLength(500, "Description must not exceed 500 characters"))),
});

export type ServiceItemRequest = zInfer<typeof serviceItemSchema>;

export const barberSchema = object({
  name: string().check(trim(), minLength(1, "Barber name is required"), maxLength(100)),
  email: optional(union([string().check(email("Email must be valid"), maxLength(100)), literal("")])),
  phone: optional(string().check(maxLength(50, "Phone must be at most 50 characters"))),
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
  description: omittedAsEmptyString(),
});

export type ServiceItemResponse = zInfer<typeof serviceItemResponseSchema>;

/** GET /api/v1/catalog response. */
export const serviceItemResponseListSchema = array(serviceItemResponseSchema);

/** GET /api/v1/barbers response item (public directory). */
export const publicBarberResponseSchema = object({
  id: number(),
  name: string(),
});

export type PublicBarberResponse = zInfer<typeof publicBarberResponseSchema>;

/** GET /api/v1/barbers response. */
export const publicBarberResponseListSchema = array(publicBarberResponseSchema);

/** GET /api/v1/barbers/admin response item. */
export const barberResponseSchema = object({
  id: number(),
  name: string(),
  // Contact details are optional in the backend projection and may be omitted.
  email: omittedAsEmptyString(),
  phone: omittedAsEmptyString(),
});

export type BarberResponse = zInfer<typeof barberResponseSchema>;

/** GET /api/v1/barbers/admin response. */
export const barberResponseListSchema = array(barberResponseSchema);
