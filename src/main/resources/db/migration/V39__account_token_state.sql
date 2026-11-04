-- JWT revocation gaps (https://github.com/stefanf81/taskflow-enterprise/issues/218).
--
-- app_users.token_version
--     Copied into every access token (claim `tv`). The decoder rejects a token whose version is not
--     the account's current one, so raising it revokes every token of that account at once (admin
--     password re-sync; demoting, deleting or "sign out everywhere" later). A per-account counter
--     rather than a "valid after" timestamp: a token's `iat` has one-second precision, so a cut-off
--     instant would either keep a token issued in the same second before it or reject one issued in
--     the same second after it.
--
-- revoked_tokens
--     The durable copy of the logout denylist. Redis (or the per-JVM map) stays the fast path; every
--     revocation is also written here and loaded back at startup and every minute, so a revocation
--     survives a backend restart during a Redis outage and a Redis restart without persistence.
--     Rows are deleted once the token has expired.
--
-- Valid on H2 and PostgreSQL.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti VARCHAR(128) PRIMARY KEY,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens (expires_at);
