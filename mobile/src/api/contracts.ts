/**
 * Runtime contract validation for API payloads (web parity).
 *
 * The shared zod schemas in `@taskflow/schemas` are the single source of
 * truth for request and response shapes. Validating here — at the transport
 * boundary — turns silent contract drift (renamed or omitted fields) into an
 * explicit error instead of undefined UI state.
 *
 * The schema parameter is structural (`parse` only) because the shared
 * workspace package may resolve its own zod copy, and nominal zod types from
 * two copies are not assignable to each other.
 */
export class ApiContractError extends Error {
  constructor(
    public readonly endpoint: string,
    detail: string,
    /** Messages of the failed checks, in schema order (the first one decides what a user sees). */
    public readonly issueMessages: readonly string[] = [],
    /**
     * True when the payload the user typed was rejected (a request), false when the server
     * answered with something the schema does not describe. Only the former is the user's to fix.
     */
    public readonly userFacing = false,
  ) {
    super(`Contract violation for ${endpoint}: ${detail}`);
    this.name = "ApiContractError";
  }
}

interface ParseableSchema<T> {
  parse(value: unknown): T;
}

export function parseContract<T>(
  schema: ParseableSchema<T>,
  value: unknown,
  endpoint: string,
  userFacing = false,
): T {
  try {
    return schema.parse(value);
  } catch (err) {
    const issues =
      (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues ??
      [];
    const detail = issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ApiContractError(
      endpoint,
      detail || "validation failed",
      issues.map((issue) => issue.message),
      userFacing,
    );
  }
}

/**
 * Validates a payload the user is about to send. A failure is the user's to fix, so the
 * error carries the schema's own message (e.g. "Invalid email format") for display.
 */
export function parseRequest<T>(
  schema: ParseableSchema<T>,
  value: unknown,
  endpoint: string,
): T {
  return parseContract(schema, value, endpoint, true);
}
