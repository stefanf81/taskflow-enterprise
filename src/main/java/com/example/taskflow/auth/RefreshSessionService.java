package com.example.taskflow.auth;

import com.example.taskflow.core.LogSanitizer;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Login session families and their one-time refresh credentials (ADR-023). SQL is authoritative:
 * no Redis dependency, and only SHA-256 hashes of the credentials are stored.
 *
 * <p>Every access token carries its family id ({@value #SESSION_CLAIM}); {@link #validate} rejects
 * it once the family is revoked or expired. That check is cached per JVM for {@link #CACHE_TTL}
 * and fails open on a database error, like {@link AccountTokenCheck}: a revocation applies at
 * once on the replica that made it and within that interval elsewhere, and a database outage
 * does not sign everybody out.
 *
 * <p>A used credential presented again within {@code app.auth.refresh.reuse-grace-seconds} gets a
 * further credential of the same family (two tabs renewing at once, a retry after a lost
 * response). Later reuse means a copy of the credential is in other hands: the whole family is
 * revoked, including its access tokens.
 */
@Service
class RefreshSessionService {
    static final String SESSION_CLAIM = "sid";
    static final Duration CACHE_TTL = Duration.ofSeconds(10);
    static final int MAX_CACHED = 10_000;
    private static final Duration WARN_INTERVAL = Duration.ofSeconds(30);
    private static final Logger logger = LoggerFactory.getLogger(RefreshSessionService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final RefreshProperties properties;
    private final Clock clock;
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();
    private final AtomicReference<Instant> lastWarning = new AtomicReference<>(Instant.EPOCH);

    record Issued(String id, String username, String role, int tokenVersion, String refreshToken,
                  Instant expiresAt) {
        Authentication authentication() {
            return UsernamePasswordAuthenticationToken.authenticated(username, null,
                    List.of(new SimpleGrantedAuthority(role)));
        }
    }

    private record Family(String id, String username, String role, int version, Instant expiry,
                          boolean revoked) {}

    private record Account(String username, String role, int version) {}

    private record Credential(boolean used, @Nullable Instant usedAt) {}

    /** {@code state} empty: no such session (never created, or purged). */
    private record Cached(Optional<SessionState> state, Instant loadedAt) {}

    private record SessionState(boolean revoked, Instant expiresAt, String username) {}

    @Autowired
    RefreshSessionService(JdbcTemplate jdbc, RefreshProperties properties) {
        this(jdbc, properties, TokenProvider.TOKEN_CLOCK);
    }

    RefreshSessionService(JdbcTemplate jdbc, RefreshProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public Issued create(Authentication authentication) {
        Account account = account(authentication.getName()).orElseThrow(
                () -> new BadCredentialsException("Account unavailable"));
        if (authentication.getAuthorities().stream().noneMatch(a -> a.getAuthority().equals(account.role()))) {
            throw new BadCredentialsException("Account changed");
        }
        String id = UUID.randomUUID().toString();
        Instant expiry = Instant.now(clock).plusSeconds("ROLE_ADMIN".equals(account.role())
                ? properties.adminLifetimeSeconds() : properties.customerLifetimeSeconds());
        jdbc.update("INSERT INTO refresh_sessions(id, username, role, token_version, expires_at, revoked) VALUES (?, ?, ?, ?, ?, FALSE)",
                id, account.username(), account.role(), account.version(), Timestamp.from(expiry));
        String secret = issueCredential(id);
        return new Issued(id, account.username(), account.role(), account.version(), secret, expiry);
    }

    /** Return rejection instead of throwing: reuse revocation MUST commit even on HTTP 401. */
    @Transactional
    public Optional<Issued> rotate(@Nullable String secret) {
        Optional<Family> found = lockFamily(secret);
        if (found.isEmpty()) return Optional.empty();
        Family family = found.get();
        Instant now = Instant.now(clock);
        Optional<Account> account = account(family.username());
        if (family.revoked() || !now.isBefore(family.expiry())
                || account.isEmpty() || account.get().version() != family.version()
                || !account.get().role().equals(family.role())) {
            revokeFamily(family.id());
            return Optional.empty();
        }
        Credential credential = jdbc.queryForObject("SELECT used, used_at FROM refresh_credentials WHERE token_hash = ?",
                (rs, row) -> new Credential(rs.getBoolean(1),
                        rs.getTimestamp(2) == null ? null : rs.getTimestamp(2).toInstant()),
                hash(secret));
        if (credential.used()) {
            boolean withinGrace = credential.usedAt() != null
                    && now.isBefore(credential.usedAt().plusSeconds(properties.reuseGraceSeconds()));
            if (!withinGrace) {
                revokeFamily(family.id());
                return Optional.empty();
            }
            // A concurrent renewal or a retry after a lost response: another credential of the
            // same family, still bounded by the family's fixed deadline.
        } else {
            jdbc.update("UPDATE refresh_credentials SET used = TRUE, used_at = ? WHERE token_hash = ?",
                    Timestamp.from(now), hash(secret));
        }
        return Optional.of(new Issued(family.id(), family.username(), family.role(), family.version(),
                issueCredential(family.id()), family.expiry()));
    }

    @Transactional
    public void revoke(@Nullable String secret) {
        lockFamily(secret).ifPresent(family -> revokeFamily(family.id()));
    }

    @Transactional
    public void revokeSession(String id) {
        // The same row lock as rotation serializes logout against renewal.
        jdbc.query("SELECT id FROM refresh_sessions WHERE id = ? FOR UPDATE", (rs, row) -> rs.getString(1), id)
                .forEach(this::revokeFamily);
    }

    /**
     * Deletes expired and revoked families (their credentials cascade). Access tokens naming a
     * deleted family are rejected like revoked ones, so nothing is lost by deleting early.
     */
    @Transactional
    public int purgeInactive() {
        return jdbc.update("DELETE FROM refresh_sessions WHERE revoked = TRUE OR expires_at < ?",
                Timestamp.from(Instant.now(clock)));
    }

    /** Family-bound access tokens die on logout/reuse too; tokens without the claim are unaffected. */
    OAuth2TokenValidatorResult validate(Jwt jwt) {
        String id = jwt.getClaimAsString(SESSION_CLAIM);
        if (id == null) return OAuth2TokenValidatorResult.success();
        Optional<SessionState> state;
        try {
            state = current(id);
        } catch (DataAccessException | TransactionException e) {
            Cached stale = cache.get(id);
            if (stale == null) {
                warnRateLimited(e);
                return OAuth2TokenValidatorResult.success();
            }
            state = stale.state();
        }
        boolean active = state.isPresent() && !state.get().revoked()
                && Instant.now(clock).isBefore(state.get().expiresAt())
                && state.get().username().equals(jwt.getSubject());
        return active ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Session revoked or expired", null));
    }

    private Optional<SessionState> current(String id) {
        Instant now = Instant.now(clock);
        Cached cached = cache.get(id);
        if (cached != null && now.isBefore(cached.loadedAt().plus(CACHE_TTL))) {
            return cached.state();
        }
        Optional<SessionState> state = jdbc.query("SELECT revoked, expires_at, username FROM refresh_sessions WHERE id = ?",
                (rs, row) -> new SessionState(rs.getBoolean(1), rs.getTimestamp(2).toInstant(), rs.getString(3)), id)
                .stream().findFirst();
        if (cache.size() >= MAX_CACHED) {
            cache.values().removeIf(entry -> !now.isBefore(entry.loadedAt().plus(CACHE_TTL)));
            if (cache.size() >= MAX_CACHED) {
                cache.clear();
            }
        }
        cache.put(id, new Cached(state, now));
        return state;
    }

    private Optional<Account> account(String username) {
        return jdbc.query("SELECT email, role, token_version FROM app_users WHERE LOWER(email) = LOWER(?)",
                (rs, row) -> new Account(rs.getString(1), rs.getString(2), rs.getInt(3)), username).stream().findFirst();
    }

    private Optional<Family> lockFamily(@Nullable String secret) {
        if (secret == null || !secret.matches("[A-Za-z0-9_-]{43}")) return Optional.empty();
        List<String> ids = jdbc.query("SELECT session_id FROM refresh_credentials WHERE token_hash = ?",
                (rs, row) -> rs.getString(1), hash(secret));
        if (ids.isEmpty()) return Optional.empty();
        return jdbc.query("SELECT id, username, role, token_version, expires_at, revoked FROM refresh_sessions WHERE id = ? FOR UPDATE",
                (rs, row) -> new Family(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4),
                        rs.getTimestamp(5).toInstant(), rs.getBoolean(6)), ids.getFirst()).stream().findFirst();
    }

    private void revokeFamily(String id) {
        jdbc.update("UPDATE refresh_sessions SET revoked = TRUE WHERE id = ?", id);
        // Forget the cached state now and again after commit, so a check that read the row
        // before this transaction committed cannot keep the family alive for CACHE_TTL.
        cache.remove(id);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    cache.remove(id);
                }
            });
        }
    }

    private String issueCredential(String id) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("INSERT INTO refresh_credentials(token_hash, session_id, used) VALUES (?, ?, FALSE)", hash(secret), id);
        return secret;
    }

    private void warnRateLimited(RuntimeException e) {
        Instant now = Instant.now(clock);
        Instant last = lastWarning.get();
        if (now.isAfter(last.plus(WARN_INTERVAL)) && lastWarning.compareAndSet(last, now)) {
            logger.warn("Refresh session check skipped, the session could not be read: {}",
                    LogSanitizer.safeMessage(e));
        }
    }

    private static String hash(String secret) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
