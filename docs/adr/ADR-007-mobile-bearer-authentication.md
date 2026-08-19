# ADR-007: Dedicated Mobile Bearer Authentication

**Status:** Accepted

## Context

The web client authenticates with an HttpOnly `access_token` cookie and a
readable CSRF cookie. Native React Native runtimes do not provide a browser
cookie jar, so relying on Axios `withCredentials` does not produce a reliable
mobile session. The mobile client already has hardware-backed storage through
Expo SecureStore.

## Decision

Web clients continue using `POST /api/v1/auth/login`, which sets the HttpOnly
cookie. Native clients use `POST /api/v1/auth/mobile/login`, which returns a
short-lived bearer token and never sets the web cookie. Mobile stores that token
in SecureStore and sends it through the `Authorization` header.

Bearer-only requests are exempt from browser CSRF protection because the token
is not an ambient credential. Any request that includes the web `access_token`
cookie remains CSRF-protected, even if it also includes an Authorization header.

Mobile logout is local token deletion; server-side revocation is intentionally
deferred until a refresh-token or `jti` deny-list design is required.

## Security Hardening

### SSL Certificate Pinning

Preview and production builds require an HTTPS API host plus two SHA-256 SPKI
public-key hashes in `TASKFLOW_API_SPKI_PINS`. The tracked Expo config plugin
`plugins/withTaskflowTlsPinning.js` generates Android network-security and iOS
`NSPinnedDomains` configuration during prebuild, so the platform networking
stack enforces pinning for the existing Axios client.
