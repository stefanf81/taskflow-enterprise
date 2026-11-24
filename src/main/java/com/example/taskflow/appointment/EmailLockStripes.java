package com.example.taskflow.appointment;

import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.dao.CannotAcquireLockException;

/**
 * Serialises booking attempts for the same e-mail address in this JVM (the per-address cap is a
 * read-check-insert), on a fixed number of lock stripes: bounded memory, and independent addresses
 * rarely share a stripe.
 *
 * <p>A caller waits at most {@code maxWait} for its stripe and then fails with
 * {@link CannotAcquireLockException}, which the API answers with 503 and {@code Retry-After}. The
 * wait used to be unbounded: during a database outage the holder kept the stripe while it waited out
 * the pool's connection timeout, and every booking queued behind it waited for all of the ones
 * ahead, one timeout each (BENCHMARKS.md §80). A healthy booking holds its stripe for milliseconds.
 */
final class EmailLockStripes {

    /** Well above a healthy booking transaction, below the client's request timeout. */
    static final Duration DEFAULT_MAX_WAIT = Duration.ofSeconds(5);

    private final ReentrantLock[] stripes;
    private final long maxWaitNanos;

    EmailLockStripes(int stripeCount, Duration maxWait) {
        if (stripeCount <= 0) {
            throw new IllegalArgumentException("stripeCount must be positive");
        }
        this.stripes = new ReentrantLock[stripeCount];
        for (int i = 0; i < stripeCount; i++) {
            stripes[i] = new ReentrantLock();
        }
        this.maxWaitNanos = Math.max(0, maxWait.toNanos());
    }

    /**
     * Takes the stripe of {@code email} (case- and whitespace-insensitive) and returns it locked;
     * the caller unlocks it in a {@code finally}.
     */
    Lock acquire(String email) {
        String key = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        ReentrantLock stripe = stripes[Math.floorMod(key.hashCode(), stripes.length)];
        try {
            if (stripe.tryLock(maxWaitNanos, TimeUnit.NANOSECONDS)) {
                return stripe;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        throw new CannotAcquireLockException("Another booking for this address is still being processed");
    }
}
