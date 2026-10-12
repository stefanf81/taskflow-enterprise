package com.example.taskflow.core;

/**
 * Published when an access token is revoked (e.g. at logout), so long-lived consumers that
 * authenticated with it — such as an open admin event stream — can drop it immediately.
 * Lives in {@code core} so modules can react without depending on the auth module.
 *
 * @param tokenId the revoked token's {@code jti}
 */
public record TokenRevokedEvent(String tokenId) {
}
