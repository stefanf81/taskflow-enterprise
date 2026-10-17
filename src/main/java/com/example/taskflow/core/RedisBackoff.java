package com.example.taskflow.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * Failure bookkeeping for best-effort Redis use with an in-memory fallback.
 *
 * <p>After a Redis error the caller skips Redis for {@code backoffMillis}, so an outage costs one
 * command timeout per interval instead of one per request (paying it on every request would turn a
 * Redis outage into an application outage). When the interval is over, {@link #allowRequest()} lets
 * exactly one caller probe Redis while every other caller keeps using the fallback: letting all of
 * them through at once stalled every in-flight request for a full command timeout each interval.
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
    private final AtomicLong skipUntilMillis = new AtomicLong();
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

    /**
     * Whether this caller should send its command to Redis now. {@code true} while Redis is healthy;
     * after a failure {@code false} until the back-off is over, then {@code true} for exactly one
     * caller (the probe), whose {@link #recordSuccess()} or {@link #recordFailure} decides for the rest.
     */
    public boolean allowRequest() {
        if (!degraded) {
            return true;
        }
        long until = skipUntilMillis.get();
        long now = clock.getAsLong();
        return now >= until && skipUntilMillis.compareAndSet(until, now + backoffMillis);
    }

    /**
     * {@code false} while backing off after a recent failure. A read-only check that claims nothing:
     * use it to decide whether trying is worthwhile; the command itself must go through
     * {@link #allowRequest()}.
     */
    public boolean isAvailable() {
        return clock.getAsLong() >= skipUntilMillis.get();
    }

    /** {@code true} between a failure and the next successful Redis call. */
    public boolean isDegraded() {
        return degraded;
    }

    public void recordFailure(RuntimeException e) {
        skipUntilMillis.set(clock.getAsLong() + backoffMillis);
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
            skipUntilMillis.set(0);
            degraded = false;
            log.info("{}: Redis reachable again, shared state restored", component);
        }
    }
}
