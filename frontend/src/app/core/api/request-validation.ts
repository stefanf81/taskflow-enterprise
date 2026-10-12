interface ZodIssueLike {
  path: PropertyKey[];
  message: string;
}

/**
 * Thrown by {@link parseRequest} when a client-side payload fails its shared
 * zod schema. `message` is the first issue's user-facing text (for example
 * "Invalid email format") so the UI can show it as-is; `field` names the
 * offending top-level property when known.
 */
export class RequestValidationError extends Error {
  readonly field: string | null;

  constructor(message: string, field: string | null, cause: unknown) {
    super(message, { cause });
    this.name = 'RequestValidationError';
    this.field = field;
  }
}

/**
 * Validates an outgoing payload against its shared zod schema.
 *
 * Call inside `defer(...)` so a validation failure becomes an observable error
 * (handled by the caller's error callback) instead of an uncaught synchronous
 * throw.
 *
 * The parameter is intentionally structural (`parse` only) rather than typed as
 * the frontend's `z.ZodType`: schemas live in the shared workspace package,
 * which may resolve its own zod copy, and nominal zod types from two copies are
 * not assignable to each other.
 */
export function parseRequest<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    const issues = (err as { issues?: ZodIssueLike[] }).issues ?? [];
    const first = issues[0];
    const field = first?.path[0];
    throw new RequestValidationError(
      first?.message?.trim() || 'Please check the form and try again.',
      field === undefined ? null : String(field),
      err,
    );
  }
}

/**
 * Validates an incoming response against its shared zod schema before it
 * reaches application state (auth role, route decisions, receipt rendering).
 * A schema mismatch becomes an observable error rather than undefined UI state.
 */
export function parseResponse<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  endpoint: string,
): T {
  try {
    return schema.parse(value);
  } catch (err) {
    const issues = (err as { issues?: ZodIssueLike[] }).issues ?? [];
    const detail = issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid response from ${endpoint} (${detail || 'validation failed'})`, {
      cause: err,
    });
  }
}
