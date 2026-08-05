import { z } from "zod";

export const serviceItemSchema = z.object({
  name: z.string().trim().min(1, "Service name is required"),
  price: z.number().positive("Price must be positive"),
  durationMinutes: z.number().int().positive("Duration must be positive"),
  category: z.string().trim().min(1, "Category is required"),
  description: z.string().optional(),
});

export type ServiceItemRequest = z.infer<typeof serviceItemSchema>;

export const barberSchema = z.object({
  name: z.string().trim().min(1, "Barber name is required").max(100),
  email: z
    .string()
    .email("Email must be valid")
    .max(100)
    .or(z.literal(""))
    .optional(),
  phone: z.string().max(50, "Phone must be at most 50 characters").optional(),
});

export type BarberRequest = z.infer<typeof barberSchema>;
