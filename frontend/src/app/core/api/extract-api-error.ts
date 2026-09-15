/**
 * Extracts a user-facing message from an HTTP error.
 *
 * The backend returns `{ message }` for handled failures; anything else (network
 * error, validation throw) falls back to the caller's copy. Centralized so all
 * call sites surface errors consistently instead of hand-rolling the same cast.
 */
export function extractApiError(err: unknown, fallback: string): string {
  const detail = (err as { error?: { message?: unknown } })?.error?.message;
  return typeof detail === 'string' && detail.trim().length > 0 ? detail : fallback;
}
