import { object, string, type infer as zInfer } from "zod";

export const loginSchema = object({
  username: string().trim().min(1, "Username is required"),
  password: string().min(1, "Password is required"),
});

export type LoginRequest = zInfer<typeof loginSchema>;

export const registerSchema = object({
  fullName: string().trim().min(1, "Full name is required").max(100),
  email: string()
    .trim()
    .min(1, "Email is required")
    .email("Valid email is required")
    .max(100),
  password: string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[0-9])(?=.*[a-zA-Z]).{8,}$/,
      "Password must be at least 8 characters long and contain both letters and numbers",
    ),
  phone: string().trim().min(1, "Phone number is required").max(50, "Phone must not exceed 50 characters"),
});

export type RegisterRequest = zInfer<typeof registerSchema>;
