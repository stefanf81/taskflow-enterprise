import { z } from "zod";

export const reviewSchema = z.object({
  rating: z
    .number()
    .min(1, "Rating must be at least 1")
    .max(5, "Rating must be at most 5"),
  comment: z
    .string()
    .max(1000, "Comment must not exceed 1000 characters")
    .optional(),
  customerEmail: z
    .string()
    .trim()
    .min(1, "Verification email is required")
    .email("Verification email must be a valid email address")
    .max(100, "Email must not exceed 100 characters"),
});

export type ReviewRequest = z.infer<typeof reviewSchema>;
