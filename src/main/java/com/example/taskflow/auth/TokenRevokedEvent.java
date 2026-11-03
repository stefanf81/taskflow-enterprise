package com.example.taskflow.auth;

/**
 * Published when an access token is revoked (e.g. at logout), so long-lived consumers that
 * authenticated with it — such as an open admin event stream — can drop it immediately.
 * Part of the auth module's API: a listener depends on this event only, never on auth's beans.
 *
 * @param tokenId the revoked token's {@code jti}
 */
public record TokenRevokedEvent(String tokenId) {
}
