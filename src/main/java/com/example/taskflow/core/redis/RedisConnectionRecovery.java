package com.example.taskflow.core.redis;
import com.example.taskflow.core.LogSanitizer;

import io.lettuce.core.RedisCommandTimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * Replaces the shared Redis connection after repeated command timeouts.
 *
 * <p>Lettuce sends every command over one shared connection. When the network silently drops it
 * (Redis pod replaced, conntrack/NAT entry expired) while commands are in flight, the kernel keeps
 * retransmitting the unacknowledged data for ~15 minutes ({@code tcp_retries2}) before it reports
 * the connection dead: TCP keepalive only probes idle connections, and {@code TCP_USER_TIMEOUT}
 * needs a native transport. Until then Lettuce does not reconnect and every command times out
 * (lettuce#2082, lettuce#1428), so the per-JVM fallbacks would serve for those 15 minutes. After
 * {@code threshold} command timeouts with no successful command in between, this runs
 * {@code reset} ({@code LettuceConnectionFactory#resetConnection()}): the next command opens a new
 * connection.
 *
 * <p>Every {@link RedisBackoff} that uses the shared connection reports here, so the count is
 * process-wide. Only command timeouts count; other failures (a refused connection, which Lettuce
 * reconnects on its own) leave the count unchanged. At most one reset runs per
 * {@code minIntervalMillis} (the back-off interval): the timeouts keep counting meanwhile, and the
 * first one after the interval resets again if the new connection hangs too. Lock-free: one
 * compare-and-set elects the caller that resets, the others carry on with their fallback.
 */
public final class RedisConnectionRecovery {

    private static final Logger log = LoggerFactory.getLogger(RedisConnectionRecovery.class);

    /** Consecutive command timeouts that trigger a reset. */
    public static final int DEFAULT_THRESHOLD = 3;
    private static final long NEVER = Long.MIN_VALUE;

    private final Runnable reset;
    private final int threshold;
    private final long minIntervalMillis;
    private final LongSupplier clock;
    private final AtomicInteger consecutiveTimeouts = new AtomicInteger();
    private final AtomicLong lastResetMillis = new AtomicLong(NEVER);
    private final AtomicLong resets = new AtomicLong();

    public RedisConnectionRecovery(Runnable reset, int threshold, long minIntervalMillis, LongSupplier clock) {
        if (threshold < 1 || minIntervalMillis < 0) {
            throw new IllegalArgumentException("threshold must be positive and minIntervalMillis not negative");
        }
        this.reset = reset;
        this.threshold = threshold;
        this.minIntervalMillis = minIntervalMillis;
        this.clock = clock;
    }

    /** Called for every failed Redis command; only command timeouts count. */
    public void recordFailure(RuntimeException e) {
        if (!isCommandTimeout(e) || consecutiveTimeouts.incrementAndGet() < threshold) {
            return;
        }
        long now = clock.getAsLong();
        long last = lastResetMillis.get();
        if (last != NEVER && now - last < minIntervalMillis) {
            return;
        }
        if (!lastResetMillis.compareAndSet(last, now)) {
            return; // another caller is resetting
        }
        int timeouts = consecutiveTimeouts.getAndSet(0);
        resets.incrementAndGet();
        log.warn("Redis: {} command timeouts in a row, replacing the shared connection", timeouts);
        try {
            reset.run();
        } catch (RuntimeException ex) {
            log.warn("Redis: replacing the shared connection failed: {}", LogSanitizer.safeMessage(ex));
        }
    }

    /** Called for every successful Redis command: the connection works, the count starts over. */
    public void recordSuccess() {
        if (consecutiveTimeouts.get() != 0) {
            consecutiveTimeouts.set(0);
        }
    }

    long resetCount() {
        return resets.get();
    }

    static boolean isCommandTimeout(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof QueryTimeoutException || t instanceof RedisCommandTimeoutException) {
                return true;
            }
        }
        return false;
    }
}
