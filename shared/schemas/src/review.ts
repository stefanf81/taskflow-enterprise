import {
  array,
  email,
  gte,
  int,
  lte,
  maxLength,
  minLength,
  number,
  object,
  optional,
  string,
  trim,
  type infer as zInfer,
} from "zod/mini";

export const reviewSchema = object({
  rating: int("Rating must be a whole number").check(
    gte(1, "Rating must be at least 1"),
    lte(5, "Rating must be at most 5"),
  ),
  comment: optional(string().check(maxLength(1000, "Comment must not exceed 1000 characters"))),
  customerEmail: string().check(
    trim(),
    minLength(1, "Verification email is required"),
    email("Verification email must be a valid email address"),
    maxLength(100, "Email must not exceed 100 characters"),
  ),
});

export type ReviewRequest = zInfer<typeof reviewSchema>;

/** GET /api/v1/reviews/public/barber-ratings response item. */
export const barberRatingResponseSchema = object({
  barberName: string(),
  averageRating: number(),
  reviewCount: number(),
});

export type BarberRatingResponse = zInfer<typeof barberRatingResponseSchema>;

/** GET /api/v1/reviews/public/barber-ratings response. */
export const barberRatingResponseListSchema = array(barberRatingResponseSchema);
