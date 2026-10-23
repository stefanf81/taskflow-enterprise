/**
 * Single source of truth for which API calls are public (guest) endpoints.
 *
 * Mirrors the `permitAll()` matchers in the backend SecurityConfig. The client
 * never attaches the bearer token to these calls: Spring answers 401 for an
 * expired/revoked token even on permitAll routes, which would otherwise break a
 * guest-capable flow (e.g. a booking) for a user whose token just expired.
 */

interface Rule {
  /** Lower-case HTTP methods, or null for any method. */
  methods: readonly string[] | null;
  test: (path: string) => boolean;
}

const rules: readonly Rule[] = [
  // Authentication bootstrap
  {
    methods: ['post'],
    test: (p) =>
      p === '/api/v1/auth/login' ||
      p === '/api/v1/auth/mobile/login' ||
      p === '/api/v1/auth/register',
  },
  // Guest booking flow
  { methods: ['get'], test: (p) => p === '/api/v1/appointments/public/busy-slots' },
  { methods: ['get'], test: (p) => p === '/api/v1/appointments/public/shop' },
  { methods: ['put'], test: (p) => /^\/api\/v1\/appointments\/public\/cancel\/[^/]+$/.test(p) },
  { methods: ['post'], test: (p) => p === '/api/v1/appointments' },
  // Reference data
  { methods: ['get'], test: (p) => p === '/api/v1/catalog' || p.startsWith('/api/v1/catalog/') },
  { methods: ['get'], test: (p) => p === '/api/v1/barbers' },
  // Guest reviews (any method)
  { methods: null, test: (p) => p.startsWith('/api/v1/reviews/public/') },
];

function pathOf(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  // Tolerate absolute URLs and trailing slashes.
  const path = withoutQuery.replace(/^https?:\/\/[^/]+/i, '');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function isPublicEndpoint(method: string | undefined, url: string | undefined): boolean {
  if (!url) return false;
  const m = (method ?? 'get').toLowerCase();
  const path = pathOf(url);
  return rules.some(
    (rule) => (rule.methods === null || rule.methods.includes(m)) && rule.test(path),
  );
}
