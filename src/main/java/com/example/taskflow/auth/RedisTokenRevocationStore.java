package com.example.taskflow.auth;

import com.example.taskflow.core.RedisBackoff;
import com.example.taskflow.core.SharedStateStore;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * Redis side of {@link TokenRevocationList} ({@code app.state.store=redis}).
 *
 * <ul>
 *   <li>{@code SET revoked:<jti> 1 PX <token exp - now>} (at least {@link #MIN_TTL_MILLIS}); never a
 *       key without TTL, so the denylist cannot outgrow the set of still-valid tokens.</li>
 *   <li>Lookup is a single {@code PTTL revoked:<jti>}: it answers "revoked?" and "until when?" in one
 *       round trip, which lets the caller cache a hit locally until the token's own expiry.</li>
 *   <li>Revocations are also announced on {@link #CHANNEL} as {@code <instanceId>|<expMillis>|<jti>}
 *       so other replicas can close admin event streams opened with that token. Messages carrying
 *       this instance's id are ignored on receipt, and a received revocation is only applied
 *       locally (never re-written or re-published), so there is no echo loop.</li>
 * </ul>
 *
 * <p>Every method returns a "Redis unavailable" result instead of throwing; failures go through a
 * {@link RedisBackoff} so an outage costs one timeout per interval and is logged once. A token value
 * is never seen here: only its {@code jti}, a random id.
 */
final class RedisTokenRevocationStore {

    static final String KEY_PREFIX = "revoked:";
    static final String CHANNEL = "taskflow:token-revoked";
    /** Floor for the key TTL so a token that is about to expire is still denied across clock skew. */
    static final long MIN_TTL_MILLIS = 5_000;
    /** {@link #remainingMillis} result: not revoked. */
    static final long NOT_REVOKED = -2;
    /** {@link #remainingMillis} result: revoked, but the key has no TTL (never written by this code). */
    static final long REVOKED_WITHOUT_TTL = -1;
    /** {@link #remainingMillis} result: Redis could not be asked. */
    static final long UNAVAILABLE = Long.MIN_VALUE;

    /** A revocation announced by another replica. */
    record RemoteRevocation(String jti, Instant expiresAt) {
    }

    private final StringRedisTemplate redis;
    private final RedisBackoff backoff;
    private final String instanceId = UUID.randomUUID().toString();

    RedisTokenRevocationStore(StringRedisTemplate redis) {
        this(redis, new RedisBackoff("Token revocation list"));
    }

    RedisTokenRevocationStore(StringRedisTemplate redis, RedisBackoff backoff) {
        this.redis = redis;
        this.backoff = backoff;
    }

    boolean isAvailable() {
        return backoff.isAvailable();
    }

    /** Writes the denylist entry; {@code false} if Redis is unavailable (the caller keeps it pending). */
    boolean write(String jti, Instant expiresAt, Instant now) {
        if (!backoff.allowRequest()) {
            return false;
        }
        long ttlMillis = Math.max(MIN_TTL_MILLIS, Duration.between(now, expiresAt).toMillis());
        try {
            redis.opsForValue().set(key(jti), "1", Duration.ofMillis(ttlMillis));
            backoff.recordSuccess();
            return true;
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            return false;
        }
    }

    /**
     * Milliseconds until the denylist entry expires (&gt; 0: revoked), or {@link #NOT_REVOKED},
     * {@link #REVOKED_WITHOUT_TTL} or {@link #UNAVAILABLE}.
     */
    long remainingMillis(String jti) {
        if (!backoff.allowRequest()) {
            return UNAVAILABLE;
        }
        try {
            // A plain PTTL. RedisTemplate.getExpire(key, unit) retries with TTL after any error,
            // which would double the timeout paid during an outage.
            byte[] rawKey = key(jti).getBytes(StandardCharsets.UTF_8);
            Long ttl = redis.execute((RedisCallback<Long>) connection -> connection.keyCommands().pTtl(rawKey));
            backoff.recordSuccess();
            if (ttl == null || ttl == -2) {
                return NOT_REVOKED;
            }
            if (ttl < 0) {
                return REVOKED_WITHOUT_TTL;
            }
            // PTTL can round a key in its last millisecond down to 0: still revoked.
            return Math.max(1, ttl);
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            return UNAVAILABLE;
        }
    }

    /** Best effort: tells the other replicas, so they close streams opened with this token. */
    void announce(String jti, Instant expiresAt) {
        if (!backoff.allowRequest()) {
            return;
        }
        try {
            redis.convertAndSend(CHANNEL, instanceId + "|" + expiresAt.toEpochMilli() + "|" + jti);
            backoff.recordSuccess();
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
        }
    }

    /** Parses an announcement; {@code null} for this instance's own messages and malformed ones. */
    RemoteRevocation parse(String message) {
        if (message == null) {
            return null;
        }
        String[] parts = message.split("\\|", 3);
        if (parts.length != 3 || parts[0].equals(instanceId) || parts[2].isBlank()) {
            return null;
        }
        try {
            return new RemoteRevocation(parts[2], Instant.ofEpochMilli(Long.parseLong(parts[1])));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    String instanceId() {
        return instanceId;
    }

    static String key(String jti) {
        return KEY_PREFIX + SharedStateStore.boundedKeyPart(jti);
    }
}
