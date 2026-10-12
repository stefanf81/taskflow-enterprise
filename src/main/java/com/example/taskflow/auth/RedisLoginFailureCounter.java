package com.example.taskflow.auth;

import com.example.taskflow.core.RedisBackoff;
import com.example.taskflow.core.SharedStateStore;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * Redis side of {@link LoginAttemptLimiter} ({@code app.state.store=redis}): one fixed window per
 * {@code username|clientIp}, shared by all replicas.
 *
 * <p>The key is {@code login_failures:<sha256(username|clientIp)>}: bounded in size whatever the
 * submitted username is, and no e-mail address or IP is stored in Redis in clear. The first failure
 * of a window sets the TTL atomically in the same Lua script as the {@code INCR} (the
 * {@code RateLimiterConfig} pattern), and the script re-arms a TTL that is somehow missing, so a key
 * can never become a permanent lock. {@code PTTL} gives {@code Retry-After}; {@code DEL} resets.
 *
 * <p>Methods return {@link #UNAVAILABLE} / {@code false} instead of throwing; the limiter then uses
 * its per-JVM counter.
 */
final class RedisLoginFailureCounter {

    static final String KEY_PREFIX = "login_failures:";
    static final long UNAVAILABLE = -1;

    private static final DefaultRedisScript<Long> INCREMENT_SCRIPT;

    static {
        // KEYS[1]=login_failures:<hash>  ARGV[1]=window in ms
        String lua = "local c = redis.call('incr', KEYS[1]); "
                + "if c == 1 or redis.call('pttl', KEYS[1]) < 0 then redis.call('pexpire', KEYS[1], ARGV[1]) end; "
                + "return c";
        INCREMENT_SCRIPT = new DefaultRedisScript<>();
        INCREMENT_SCRIPT.setScriptText(lua);
        INCREMENT_SCRIPT.setResultType(Long.class);
    }

    private final StringRedisTemplate redis;
    private final RedisBackoff backoff;

    RedisLoginFailureCounter(StringRedisTemplate redis) {
        this(redis, new RedisBackoff("Login attempt limiter"));
    }

    RedisLoginFailureCounter(StringRedisTemplate redis, RedisBackoff backoff) {
        this.redis = redis;
        this.backoff = backoff;
    }

    /** Failures in the current window, or {@link #UNAVAILABLE}. */
    long current(String accountKey) {
        if (!backoff.isAvailable()) {
            return UNAVAILABLE;
        }
        try {
            String value = redis.opsForValue().get(key(accountKey));
            backoff.recordSuccess();
            return value == null ? 0 : Long.parseLong(value);
        } catch (NumberFormatException e) {
            return 0;
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            return UNAVAILABLE;
        }
    }

    /** Records one failure and returns the window's count, or {@link #UNAVAILABLE}. */
    long increment(String accountKey, long windowMillis) {
        if (!backoff.isAvailable()) {
            return UNAVAILABLE;
        }
        try {
            Long count = redis.execute(INCREMENT_SCRIPT, Collections.singletonList(key(accountKey)),
                    String.valueOf(windowMillis));
            backoff.recordSuccess();
            return count == null ? UNAVAILABLE : count;
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            return UNAVAILABLE;
        }
    }

    /** Seconds until the window ends (at least 1), or {@link #UNAVAILABLE}. */
    long secondsUntilReset(String accountKey) {
        if (!backoff.isAvailable()) {
            return UNAVAILABLE;
        }
        try {
            byte[] rawKey = key(accountKey).getBytes(StandardCharsets.UTF_8);
            Long ttl = redis.execute((RedisCallback<Long>) connection -> connection.keyCommands().pTtl(rawKey));
            backoff.recordSuccess();
            return ttl == null || ttl <= 0 ? 1 : Math.max(1, (ttl + 999) / 1000);
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            return UNAVAILABLE;
        }
    }

    /** Clears the window; {@code false} if Redis is unavailable. */
    boolean reset(String accountKey) {
        if (!backoff.isAvailable()) {
            return false;
        }
        try {
            redis.delete(key(accountKey));
            backoff.recordSuccess();
            return true;
        } catch (RuntimeException e) {
            backoff.recordFailure(e);
            return false;
        }
    }

    static String key(String accountKey) {
        return KEY_PREFIX + SharedStateStore.sha256Hex(accountKey);
    }
}
