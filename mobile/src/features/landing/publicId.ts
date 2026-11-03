/**
 * Public booking references are lowercase UUIDs and the backend looks them up by exact match, so
 * anything typed or pasted is trimmed and lower-cased (shared with the web app).
 */
export { normalizePublicId } from '@taskflow/domain';

export const PUBLIC_ID_PLACEHOLDER = 'e.g. 123e4567-e89b-12d3-a456-426614174000';
