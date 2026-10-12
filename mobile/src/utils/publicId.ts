/**
 * Public booking references are lowercase UUIDs and the backend looks them up
 * by exact match, so anything typed or pasted must be trimmed and lower-cased.
 */
export const PUBLIC_ID_PLACEHOLDER = 'e.g. 123e4567-e89b-12d3-a456-426614174000';

export function normalizePublicId(value: string): string {
  return value.trim().toLowerCase();
}
