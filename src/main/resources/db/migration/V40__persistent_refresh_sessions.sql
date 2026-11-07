-- Each login creates a device family with a fixed (never sliding) deadline.
CREATE TABLE refresh_sessions (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    token_version INTEGER NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_refresh_sessions_expiry ON refresh_sessions(expires_at);
-- One row per issued one-time credential (SHA-256 of the secret, never the secret itself).
-- used_at starts the short reuse grace window (app.auth.refresh.reuse-grace-seconds).
CREATE TABLE refresh_credentials (
    token_hash VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL REFERENCES refresh_sessions(id) ON DELETE CASCADE,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_refresh_credentials_session ON refresh_credentials(session_id);
