import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginRequest = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(100),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Valid email is required")
    .max(100),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[0-9])(?=.*[a-zA-Z]).{8,}$/,
      "Password must be at least 8 characters long and contain both letters and numbers",
    ),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .max(50, "Phone must not exceed 50 characters"),
});

export type RegisterRequest = z.infer<typeof registerSchema>;
