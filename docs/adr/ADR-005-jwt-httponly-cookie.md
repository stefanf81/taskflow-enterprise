# ADR-005: JWT in HttpOnly Cookie (not localStorage)

**Status:** Accepted

## Context

The application uses JWT (JSON Web Token) for stateless authentication. The JWT is signed with RSA-2048 via OAuth2 Resource Server and must be sent to the backend with every authenticated request. Two storage strategies were evaluated:

1. **localStorage / sessionStorage** — the JWT is stored in browser storage and attached to requests via an Angular HTTP interceptor.
2. **HttpOnly, SameSite=Strict cookie** — the backend sets the JWT as a cookie that the browser automatically attaches to same-origin requests.

## Decision

The JWT is stored in an **HttpOnly, SameSite=Strict cookie** set by the backend. The Angular application derives authentication state by calling the backend's `/api/v1/auth/me` endpoint.

Key points of the decision:

1. **Reduced XSS token-theft impact** — since the cookie is marked `HttpOnly`, JavaScript code (including any injected by XSS attacks) cannot read the JWT. In the localStorage approach, a single XSS vulnerability would leak the token.

2. **CSRF protection via double-submit cookie pattern** — in addition to `SameSite=Strict`, the application implements the double-submit CSRF pattern: the backend sets a readable `XSRF-TOKEN` cookie (via `CookieCsrfTokenRepository.withHttpOnlyFalse()`), and Angular's `withXsrfConfiguration` reads that cookie and attaches it as the `X-XSRF-TOKEN` header on state-changing requests. The backend compares the header against the cookie value. This provides defense-in-depth against CSRF even if `SameSite` is bypassed (e.g., older browsers, proxy de-escalation).

3. **Automatic cookie attachment** — the browser automatically includes the cookie in same-origin requests. The Angular `auth.interceptor.ts` does not need to read, manage, or refresh tokens — it simply allows the cookie to be sent.

4. **No manual token management** — there is no JavaScript code to store, retrieve, or refresh the JWT. The backend controls the token lifecycle: issuance (on login), refresh (via a refresh cookie or rotation), and invalidation (by clearing the cookie or setting a short `MaxAge`).

5. **Auth state from `/auth/me`** — the Angular app calls the backend's `/api/v1/auth/me` endpoint on startup and periodically to verify the session is still valid and to obtain user details (name, roles, etc.). This endpoint returns the user's identity but never exposes the JWT itself.

## Consequences

### Positive
- **Strong token-theft protection during XSS** — the authentication token is never accessible to JavaScript, reducing the most direct token theft path during cross-site scripting.
- **Simpler frontend code** — no token storage, retrieval, or refresh logic in JavaScript. The auth interceptor is minimal.
- **Automatic cookie lifecycle** — the browser handles cookie expiry, secure-only transmission over HTTPS, and same-origin scoping.
- **Backend-controlled security** — token rotation, invalidation, and renewal are entirely server-side.
- **Configurable token lifetime** — the JWT expiry is controlled by `app.jwt.lifetime-seconds` (default 3600s), allowing per-environment tuning without a code change.

### Negative
- **Requires cookie-accessible deployment** — the frontend and backend must be served from the same origin (or with proper CORS + `SameSite=None; Secure` configuration for cross-origin).
- **CSRF exemptions for public/guest endpoints** — the double-submit CSRF protection is intentionally disabled on public state-changing endpoints (`POST /api/v1/appointments`, `PUT /api/v1/appointments/public/cancel/*`, `POST /api/v1/reviews/public/**`) to allow unauthenticated guest bookings.
- **Larger cookie size** — JWTs can exceed the 4 KB cookie size limit if they carry many claims. The application keeps claims minimal (sub, roles, iat, exp) to stay well within limits.
- **No programmatic token inspection** — the frontend cannot inspect the JWT payload to check roles or expiration without a backend call (`/auth/me`), adding a minor latency cost for auth state checks.
