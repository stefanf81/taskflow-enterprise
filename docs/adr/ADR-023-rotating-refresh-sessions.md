# ADR-023: Rotating Refresh Sessions for Web and Mobile

**Status:** Accepted

## Context

Access tokens are short-lived JWTs (1 h): an HttpOnly `access_token` cookie on the web (ADR-005) and a bearer token in SecureStore on mobile (ADR-007). When one expired the user was signed out, mid-booking or mid-dashboard, and had to log in again. A longer access token would widen the window in which a copied token works, and logout could only deny the one token it was given (`TokenRevocationList`).

## Decision

1. **A login creates a session family** (`refresh_sessions`, V40) with a fixed deadline: 30 days for customers, 8 hours for admins (`app.auth.refresh.*-lifetime-seconds`). Renewal never moves it. Every access token names its family in the `sid` claim.
2. **One-time refresh credentials** (`refresh_credentials`): 256-bit random secrets, stored only as SHA-256 hashes. `POST /api/v1/auth/refresh` (web: HttpOnly `refresh_token` cookie, `Path=/api/v1/auth`, `SameSite=Strict`, CSRF double-submit required) and `POST /api/v1/auth/mobile/refresh` (native: secret in the body, SecureStore key `taskflow_refresh_token`) mark the presented credential used and issue a new one plus a new access token. The family row is locked (`FOR UPDATE`), so concurrent renewals and logout serialize.
3. **Reuse detection with a short grace.** A used credential presented again within `app.auth.refresh.reuse-grace-seconds` (default 30 s) gets another credential of the same family: two tabs renewing at once, or a retry after a lost response. Later reuse means a copy is in other hands: the whole family is revoked, and with it every access token naming it.
4. **Family-bound access tokens.** The JWT decoder rejects a token whose family is revoked, expired or deleted (`RefreshSessionService.validate`). The check is cached per JVM for 10 s and **fails open** on a database error, like `AccountTokenCheck` (ADR-018): a revocation applies at once on the replica that made it and within 10 s elsewhere; an outage does not sign everybody out. Tokens without `sid` (issued before V40) keep their old behaviour.
5. **Logout ends the family**, through the access token's `sid` and through any refresh credential presented (cookie or body), and clears the cookies. A native logout with an expired bearer is treated as anonymous so it can still revoke its refresh credential.
6. **The SPA cannot see the credential**, so the server also sets a readable `taskflow_session=1` hint cookie (no secret) next to it. Only when the hint is present does the web app answer a protected 401, or a boot-time `/auth/me` 401, with one renewal and one replay; nginx serves the client-rendered shell to such a browser. A refused renewal clears both cookies.
7. **Clients renew once and replay once.** Spring rejects an invalid token before any handler runs, so replaying the rejected request (any method) after a successful renewal cannot repeat a side effect. Mobile renews only a request that actually carried a bearer token (a signed-out device is never signed back in), and its logout erases the refresh token from SecureStore even when the server cannot be reached.
8. **Only a rejection ends a session.** A renewal answered with 401 (or, on mobile, no stored refresh token) signs the user out. A network failure, a timeout, a 5xx or 429, or an unreadable Keychain/Keystore keeps the session: the caller gets that error and the next request tries again. Mobile's `storage.getRefreshToken()` therefore throws on a read error instead of answering "none".
9. **Renewals and 401s are fenced by session epoch.** Each client counts sign-ins and sign-outs (web `SessionEvents.epoch()`, mobile `storage.getSessionEpoch()`); a renewal or boot restore continues the session and does not count. A request remembers the epoch it was sent under (its replay keeps it), a renewal the epoch it started in, read before anything else. Once the epoch has moved on, a 401 neither ends nor renews the newer session, and a renewal's answer, success or rejection, becomes `SessionChangedError`: nothing is applied or stored, the request is not replayed, and mobile never sends it with the newer session's token. Mobile also serializes credential batches (sign-in `startSession`, renewal `rotateSession`, sign-out `clearSession`; the rotation writes the new refresh token first) and makes reads wait for batches requested before them, so a sign-out during a rotation still leaves nothing behind.
10. **Bounded storage.** `RefreshSessionPurger` deletes revoked and expired families hourly (credentials cascade).

## Consequences

### Positive
- Sessions survive the 1 h access-token lifetime without longer-lived access tokens.
- Logout, a password change (token version) or a detected reuse ends every token of the session, not just the presented one.
- No Redis dependency: the session state is authoritative in SQL.

### Negative
- One indexed query per authenticated request and family every 10 s per replica (cached), plus a write per renewal.
- A revocation reaches other replicas within the 10 s cache TTL; the presented token of a logout is denied everywhere at once through `TokenRevocationList`.
- The 30 s grace lets a credential stolen within that window fork a chain of the same family; the family deadline still bounds it.
- A device whose renewal response is lost and that does not retry within the grace is signed out at its next renewal.

## Verification

- `RefreshSessionIntegrationTest`: rotation, reuse revocation (grace 0 over HTTP), the grace window, purge, cached and fail-open validation, the web cookie flow with CSRF and the hint cookie.
- `AuthControllerTest`, `SecurityConfigTest` (which cookies count as ambient credentials), `SecurityAuthorizationIntegrationTest` (access rules of the renewal endpoints).
- Web: `auth.state.spec.ts` (renewal at boot and on a protected 401, single flight, CSRF retry, replay rejection, transient renewal failures, renewals and 401s overtaken by a logout or a newer login). Mobile: `api.client.test.ts` (the same, plus a logout while the refresh token is read and an unreadable Keychain), `storage.test.ts` (session batches, a logout during a rotation), `useAuthStore.test.ts`.
