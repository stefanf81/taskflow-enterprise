package com.example.taskflow.auth;

/**
 * Published when every access token of an account has been revoked at once (its token version was
 * raised), so long-lived consumers that authenticated as that account, such as an open admin event
 * stream, can drop it. Part of the auth module's API, like {@link TokenRevokedEvent}.
 *
 * @param username the account's login name (its e-mail, or the configured admin name)
 */
public record AccountTokensRevokedEvent(String username) {
}
