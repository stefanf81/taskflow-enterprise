/**
 * The human-readable message of an API error body: RFC 9457 `detail`, else the legacy `message`.
 * A problem's `title` is deliberately not used: it is the generic reason phrase ("Bad Gateway",
 * "Content Too Large"), and the caller's own fallback says more about what failed.
 */
export function apiErrorMessage(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  for (const key of ["detail", "message"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
