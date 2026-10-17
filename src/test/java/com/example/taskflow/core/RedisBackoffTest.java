package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** After a failure, exactly one caller per interval probes Redis; the others keep the fallback. */
class RedisBackoffTest {

    private final AtomicLong now = new AtomicLong(10_000);
    private final RedisBackoff backoff = new RedisBackoff("test", 5_000, now::get);
    private final RuntimeException failure = new RedisConnectionFailureException("down");

    @Test
    void healthyRedisIsAlwaysTried() {
        assertTrue(backoff.allowRequest());
        assertTrue(backoff.allowRequest());
        assertTrue(backoff.isAvailable());
    }

    @Test
    void afterAFailureOnlyOneProbePerInterval() {
        backoff.recordFailure(failure);
        assertFalse(backoff.allowRequest(), "backing off");
        assertFalse(backoff.isAvailable());

        now.addAndGet(5_000);
        assertTrue(backoff.isAvailable(), "a peek claims nothing");
        assertTrue(backoff.allowRequest(), "first caller after the interval probes");
        assertFalse(backoff.allowRequest(), "everyone else keeps the fallback meanwhile");
        assertFalse(backoff.allowRequest());
    }

    @Test
    void successfulProbeRestoresEveryone() {
        backoff.recordFailure(failure);
        now.addAndGet(5_000);
        assertTrue(backoff.allowRequest());

        backoff.recordSuccess();

        assertFalse(backoff.isDegraded());
        assertTrue(backoff.allowRequest());
        assertTrue(backoff.allowRequest());
        assertTrue(backoff.isAvailable());
    }

    @Test
    void failedProbeStartsANewInterval() {
        backoff.recordFailure(failure);
        now.addAndGet(5_000);
        assertTrue(backoff.allowRequest());

        backoff.recordFailure(failure);

        assertFalse(backoff.allowRequest());
        now.addAndGet(5_000);
        assertTrue(backoff.allowRequest());
    }
}
