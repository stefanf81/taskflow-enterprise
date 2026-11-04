package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.RevokedTokenRepository;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * The durable copy of the logout denylist in PostgreSQL ({@code revoked_tokens}, V39,
 * https://github.com/stefanf81/taskflow-enterprise/issues/218).
 *
 * <p>{@link TokenRevocationList} writes every revocation here as well as to Redis (or its per-JVM map),
 * and {@link TokenRevocationRestorer} loads the unexpired ones back at startup and every minute. Without
 * it, a revocation made during a Redis outage lived only in the revoking replica's memory, and a Redis
 * restart without persistence forgot them all. Requests never read this table; they keep using the
 * Redis/local fast path.
 */
@Component
class PersistentTokenRevocations {

    private static final Logger logger = LoggerFactory.getLogger(PersistentTokenRevocations.class);

    /** Longest {@code jti} stored; ours are UUIDs (36 characters), the column holds 128. */
    static final int MAX_JTI_LENGTH = 128;
    /** At most this many revocations are loaded per run, the longest-lived first. */
    static final int MAX_RESTORED = 10_000;

    private final RevokedTokenRepository repository;

    PersistentTokenRevocations(RevokedTokenRepository repository) {
        this.repository = repository;
    }

    /**
     * Never throws: a failed write is logged and the revocation stays enforced through Redis or the
     * local map; it is just not durable. Logging out must not fail because of this copy.
     */
    void save(String jti, Instant expiresAt) {
        if (jti.length() > MAX_JTI_LENGTH) {
            return;
        }
        try {
            repository.save(new RevokedToken(jti, expiresAt));
        } catch (RuntimeException e) {
            logger.warn("Token revocation could not be stored durably (still enforced in Redis/memory): {}",
                    LogSanitizer.safeMessage(e));
        }
    }

    List<RevokedToken> active(Instant now) {
        return repository.findActive(now, PageRequest.of(0, MAX_RESTORED));
    }

    int deleteExpired(Instant now) {
        return repository.deleteExpired(now);
    }
}
