package com.example.taskflow.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.LongSupplier;

/**
 * Failure bookkeeping for best-effort Redis use with an in-memory fallback.
 *
 * <p>After a Redis error the caller skips Redis for {@code backoffMillis}, so an outage costs one
 * command timeout per interval instead of one per request (the prod client timeout is 2 s; paying it
 * on every authenticated request would turn a Redis outage into an application outage). The same
 * pattern is used inline by {@code RateLimiterConfig}.
 *
 * <p>Logging is rate-limited by construction: one WARN when Redis becomes unavailable, one INFO when
 * it answers again, DEBUG in between. Only the component name and the exception message are logged,
 * never keys or values (keys can carry token ids; values can carry lock tokens).
 */
public final class RedisBackoff {

    private static final Logger log = LoggerFactory.getLogger(RedisBackoff.class);

    /** Same back-off the rate limiter uses. */
    public static final long DEFAULT_BACKOFF_MILLIS = 5_000;

    private final String component;
    private final long backoffMillis;
    private final LongSupplier clock;
    private volatile long skipUntilMillis;
    private volatile boolean degraded;

    public RedisBackoff(String component) {
        this(component, DEFAULT_BACKOFF_MILLIS, System::currentTimeMillis);
    }

    public RedisBackoff(String component, long backoffMillis, LongSupplier clock) {
        if (backoffMillis < 0) {
            throw new IllegalArgumentException("backoffMillis must not be negative");
        }
        this.component = component;
        this.backoffMillis = backoffMillis;
        this.clock = clock;
    }

    /** {@code false} while backing off after a recent failure: use the in-memory fallback. */
    public boolean isAvailable() {
        return clock.getAsLong() >= skipUntilMillis;
    }

    /** {@code true} between a failure and the next successful Redis call. */
    public boolean isDegraded() {
        return degraded;
    }

    public void recordFailure(RuntimeException e) {
        skipUntilMillis = clock.getAsLong() + backoffMillis;
        if (!degraded) {
            degraded = true;
            log.warn("{}: Redis unavailable, using the per-JVM fallback and retrying every {} ms: {}",
                    component, backoffMillis, LogSanitizer.safeMessage(e));
        } else if (log.isDebugEnabled()) {
            log.debug("{}: Redis still unavailable: {}", component, LogSanitizer.safeMessage(e));
        }
    }

    public void recordSuccess() {
        if (degraded) {
            degraded = false;
            log.info("{}: Redis reachable again, shared state restored", component);
        }
    }
}
