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
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [];
    const detail = issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid request payload (${detail || 'validation failed'})`, { cause: err });
  }
}
