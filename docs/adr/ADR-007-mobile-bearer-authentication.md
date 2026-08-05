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

Production mobile builds fail-fast if `EXPO_PUBLIC_SSL_PIN_FINGERPRINTS` is not
configured. The `getSslPinningConfig()` parser validates the configuration at
client initialization. Full cryptographic pinning requires a native module
(`react-native-ssl-pinning` or equivalent); the config validation ensures the
deployment pipeline cannot accidentally ship without pinning metadata.

See `src/utils/sslPinning.ts` for setup instructions and `src/api/client.ts`
for the production validation guard.
