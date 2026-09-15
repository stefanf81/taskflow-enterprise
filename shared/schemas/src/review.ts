import { number, object, string, type infer as zInfer } from "zod";

export const reviewSchema = object({
  rating: number()
    .int("Rating must be a whole number")
    .min(1, "Rating must be at least 1")
    .max(5, "Rating must be at most 5"),
  comment: string().max(1000, "Comment must not exceed 1000 characters").optional(),
  customerEmail: string()
    .trim()
    .min(1, "Verification email is required")
    .email("Verification email must be a valid email address")
    .max(100, "Email must not exceed 100 characters"),
});

export type ReviewRequest = zInfer<typeof reviewSchema>;

/** GET /api/v1/reviews/public/barber-ratings response item. */
export const barberRatingResponseSchema = object({
  barberName: string(),
  averageRating: number(),
  reviewCount: number(),
});

export type BarberRatingResponse = zInfer<typeof barberRatingResponseSchema>;
