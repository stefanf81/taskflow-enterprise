import { enum as zEnum, literal, number, object, string, type infer as zInfer } from "zod";

/**
 * Roles the backend can issue. Validating the enum at the transport boundary
 * prevents an unknown role from reaching navigation/route decisions.
 */
export const roleSchema = zEnum(["ROLE_ADMIN", "ROLE_CUSTOMER"]);

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

/** POST /api/v1/auth/login and GET /api/v1/auth/me response. */
export const loginResponseSchema = object({
  username: string().min(1),
  role: roleSchema,
});

/** POST /api/v1/auth/mobile/login response (native bearer login). */
export const mobileLoginResponseSchema = object({
  accessToken: string().min(1),
  tokenType: literal("Bearer"),
  expiresIn: number().int().positive(),
  username: string().min(1),
  role: roleSchema,
});

/** POST /api/v1/auth/register response. */
export const registerResponseSchema = object({
  message: string(),
});
