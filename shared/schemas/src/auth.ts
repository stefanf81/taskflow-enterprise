import {
  email,
  enum as zEnum,
  int,
  literal,
  maxLength,
  minLength,
  object,
  optional,
  positive,
  refine,
  regex,
  string,
  trim,
  type infer as zInfer,
} from "zod/mini";

const MAX_PASSWORD_UTF8_BYTES = 72;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    // Reject unpaired UTF-16 surrogates rather than hashing a runtime-specific replacement.
    if (point >= 0xd800 && point <= 0xdfff) return Infinity;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * Roles the backend can issue. Validating the enum at the transport boundary
 * prevents an unknown role from reaching navigation/route decisions.
 */
export const roleSchema = zEnum(["ROLE_ADMIN", "ROLE_CUSTOMER"]);

export const loginSchema = object({
  username: string().check(trim(), minLength(1, "Username is required")),
  password: string().check(minLength(1, "Password is required")),
});

export type LoginRequest = zInfer<typeof loginSchema>;

export const registerSchema = object({
  fullName: string().check(
    trim(),
    minLength(1, "Full name is required"),
    maxLength(100, "Full name must not exceed 100 characters"),
  ),
  email: string().check(
    trim(),
    minLength(1, "Email is required"),
    email("Valid email is required"),
    maxLength(100, "Email must not exceed 100 characters"),
  ),
  password: string().check(
    minLength(8, "Password must be at least 8 characters"),
    regex(
      /^(?=.*[0-9])(?=.*[a-zA-Z]).{8,}$/,
      "Password must be at least 8 characters long and contain both letters and numbers",
    ),
    refine((value) => utf8ByteLength(value) <= MAX_PASSWORD_UTF8_BYTES, {
      message: "Password must not exceed 72 UTF-8 bytes",
    }),
  ),
  phone: string().check(
    trim(),
    minLength(1, "Phone number is required"),
    maxLength(50, "Phone must not exceed 50 characters"),
  ),
});

export type RegisterRequest = zInfer<typeof registerSchema>;

/** POST /api/v1/auth/login and GET /api/v1/auth/me response. */
export const loginResponseSchema = object({
  username: string().check(minLength(1)),
  role: roleSchema,
});

/** POST /api/v1/auth/mobile/login response (native bearer login). */
export const mobileLoginResponseSchema = object({
  accessToken: string().check(minLength(1)),
  tokenType: literal("Bearer"),
  expiresIn: int().check(positive()),
  username: string().check(minLength(1)),
  role: roleSchema,
  refreshToken: optional(string().check(regex(/^[A-Za-z0-9_-]{43}$/))),
});

/** POST /api/v1/auth/register response. */
export const registerResponseSchema = object({
  message: string(),
});
