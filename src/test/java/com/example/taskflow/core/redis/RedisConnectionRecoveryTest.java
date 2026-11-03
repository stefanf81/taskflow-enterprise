package com.example.taskflow.core.redis;

import io.lettuce.core.RedisCommandTimeoutException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RedisConnectionRecoveryTest {

    private static final QueryTimeoutException TIMEOUT =
            new QueryTimeoutException("Redis command timed out", new RedisCommandTimeoutException("250 ms"));

    private final AtomicLong now = new AtomicLong(1_000_000);
    private final AtomicInteger resets = new AtomicInteger();
    private final RedisConnectionRecovery recovery =
            new RedisConnectionRecovery(resets::incrementAndGet, 3, 5_000, now::get);

    @Test
    void consecutiveTimeoutsResetTheConnectionOnce() {
        recovery.recordFailure(TIMEOUT);
        recovery.recordFailure(TIMEOUT);
        assertEquals(0, resets.get(), "below the threshold");

        recovery.recordFailure(TIMEOUT);
        assertEquals(1, resets.get());

        recovery.recordFailure(TIMEOUT);
        recovery.recordFailure(TIMEOUT);
        assertEquals(1, resets.get(), "the count starts over after a reset");
    }

    @Test
    void aSuccessStartsTheCountOver() {
        recovery.recordFailure(TIMEOUT);
        recovery.recordFailure(TIMEOUT);
        recovery.recordSuccess();
        recovery.recordFailure(TIMEOUT);
        recovery.recordFailure(TIMEOUT);

        assertEquals(0, resets.get());
    }

    @Test
    void onlyCommandTimeoutsCount() {
        for (int i = 0; i < 10; i++) {
            recovery.recordFailure(new RedisConnectionFailureException("refused"));
            recovery.recordFailure(new IllegalStateException("other"));
        }
        assertEquals(0, resets.get(), "Lettuce reconnects a refused connection on its own");

        // A failure that is not a timeout neither counts nor breaks the run of timeouts.
        recovery.recordFailure(TIMEOUT);
        recovery.recordFailure(new RedisConnectionFailureException("refused"));
        recovery.recordFailure(new RedisCommandTimeoutException("raw lettuce timeout"));
        recovery.recordFailure(TIMEOUT);
        assertEquals(1, resets.get());
    }

    @Test
    void resetsAreRateLimitedToOnePerInterval() {
        for (int i = 0; i < 30; i++) {
            recovery.recordFailure(TIMEOUT);
        }
        assertEquals(1, resets.get(), "a hang that persists after the reset must not reset per request");

        now.addAndGet(4_999);
        recovery.recordFailure(TIMEOUT);
        assertEquals(1, resets.get());

        now.addAndGet(1);
        recovery.recordFailure(TIMEOUT);
        assertEquals(2, resets.get(), "the timeouts kept counting; the first one after the interval resets");
    }

    @Test
    void aFailingResetIsSwallowed() {
        RedisConnectionRecovery failing = new RedisConnectionRecovery(() -> {
            throw new IllegalStateException("factory stopped");
        }, 1, 5_000, now::get);

        failing.recordFailure(TIMEOUT);

        assertEquals(1, failing.resetCount());
    }

    @Test
    void concurrentTimeoutsResetOnlyOnce() throws Exception {
        CountDownLatch inReset = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger concurrentResets = new AtomicInteger();
        RedisConnectionRecovery slow = new RedisConnectionRecovery(() -> {
            concurrentResets.incrementAndGet();
            inReset.countDown();
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, 3, 5_000, now::get);

        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < 200; i++) {
                pool.execute(() -> slow.recordFailure(TIMEOUT));
            }
            assertTrue(inReset.await(5, TimeUnit.SECONDS));
            release.countDown();
        }

        assertEquals(1, concurrentResets.get());
    }

    @Test
    void recognisesTimeoutsAnywhereInTheCauseChain() {
        assertTrue(RedisConnectionRecovery.isCommandTimeout(TIMEOUT));
        assertTrue(RedisConnectionRecovery.isCommandTimeout(new RuntimeException(TIMEOUT)));
        assertTrue(RedisConnectionRecovery.isCommandTimeout(new RedisCommandTimeoutException("x")));
        assertFalse(RedisConnectionRecovery.isCommandTimeout(new RedisConnectionFailureException("x")));
    }

    @Test
    void backoffReportsEveryOutcome() {
        RedisBackoff backoff = new RedisBackoff("test", 0, now::get, recovery);

        backoff.recordFailure(TIMEOUT);
        backoff.recordFailure(TIMEOUT);
        backoff.recordSuccess();
        backoff.recordFailure(TIMEOUT);
        backoff.recordFailure(TIMEOUT);
        assertEquals(0, resets.get(), "the success in between broke the run");

        backoff.recordFailure(TIMEOUT);
        assertEquals(1, resets.get());
    }

    @Test
    void rejectsInvalidSettings() {
        assertThrows(IllegalArgumentException.class, () -> new RedisConnectionRecovery(() -> { }, 0, 1, now::get));
        assertThrows(IllegalArgumentException.class, () -> new RedisConnectionRecovery(() -> { }, 1, -1, now::get));
    }
}
