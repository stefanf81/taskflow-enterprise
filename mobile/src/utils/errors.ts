/** Helpers for turning Axios/transport failures into user-visible messages. */

interface HttpErrorShape {
  response?: {
    status?: number;
    data?: { message?: unknown } | null;
    headers?: Record<string, unknown> | null;
  };
}

function asHttpError(err: unknown): HttpErrorShape | null {
  return err && typeof err === 'object' && 'response' in err ? (err as HttpErrorShape) : null;
}

/** HTTP status of a failed request, or undefined for non-HTTP failures. */
export function getHttpStatus(err: unknown): number | undefined {
  return asHttpError(err)?.response?.status;
}

/**
 * Seconds to wait from a `Retry-After` header (delta-seconds or HTTP-date).
 * Returns null when the header is absent or unusable.
 */
export function getRetryAfterSeconds(err: unknown, now: number = Date.now()): number | null {
  const headers = asHttpError(err)?.response?.headers;
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'retry-after');
  const raw = key ? headers[key] : undefined;
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return Math.max(1, parseInt(text, 10));
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(1, Math.ceil((date - now) / 1000));
}

/**
 * Best user-facing message for a failed API call.
 *
 * - 429: "Too many attempts, try again in N s" (from Retry-After when present)
 * - otherwise the server `{ message }` when provided (booking rule violations,
 *   409 conflicts, 400 unknown barber, ...)
 * - 503 without a body: a "temporarily unavailable" hint
 * - otherwise the Error message, or `fallback`
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const http = asHttpError(err);
  const status = http?.response?.status;

  if (status === 429) {
    const seconds = getRetryAfterSeconds(err);
    return seconds !== null
      ? `Too many attempts, try again in ${seconds} s`
      : 'Too many attempts, try again later';
  }

  const serverMessage = http?.response?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage;
  }

  if (status === 503) {
    return 'The service is temporarily unavailable. Please try again in a moment.';
  }

  if (!http && err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
