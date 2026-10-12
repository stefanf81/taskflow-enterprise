package com.example.taskflow.core;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

class FixedWindowCounterTest {

    private final AtomicLong now = new AtomicLong(1_000_000);

    private FixedWindowCounter counter(long windowMillis, int maxKeys) {
        return new FixedWindowCounter(windowMillis, maxKeys, now::get);
    }

    @Test
    void countsWithinAWindowAndRestartsAfterIt() {
        FixedWindowCounter c = counter(60_000, 100);

        assertEquals(1, c.increment("k"));
        assertEquals(2, c.increment("k"));
        assertEquals(2, c.current("k"));

        now.addAndGet(59_999);
        assertEquals(3, c.increment("k"), "still the same window");

        now.addAndGet(1);
        assertEquals(0, c.current("k"), "window has ended");
        assertEquals(1, c.increment("k"), "a new window starts at 1");
    }

    @Test
    void keysAreIndependentAndResettable() {
        FixedWindowCounter c = counter(60_000, 100);
        c.increment("a");
        c.increment("a");
        c.increment("b");

        assertEquals(2, c.current("a"));
        assertEquals(1, c.current("b"));

        c.reset("a");
        assertEquals(0, c.current("a"));
        assertEquals(1, c.current("b"));
    }

    @Test
    void secondsUntilResetRoundsUpAndNeverReturnsZero() {
        FixedWindowCounter c = counter(60_000, 100);
        assertEquals(1, c.secondsUntilReset("unknown"));

        c.increment("k");
        assertEquals(60, c.secondsUntilReset("k"));
        now.addAndGet(59_500);
        assertEquals(1, c.secondsUntilReset("k"));
        now.addAndGet(10_000);
        assertEquals(1, c.secondsUntilReset("k"));
    }

    @Test
    void aFloodOfNewKeysCannotEvictOrResetLiveCounters() {
        FixedWindowCounter c = counter(60_000, 3);
        c.increment("victim");
        c.increment("victim");
        c.increment("x");
        c.increment("y");

        // Map is full: new keys are not tracked (count 0)...
        assertEquals(0, c.increment("attacker-1"));
        assertEquals(0, c.increment("attacker-2"));
        assertEquals(3, c.size());
        // ...and existing keys keep counting from where they were.
        assertEquals(3, c.increment("victim"));
    }

    @Test
    void expiredWindowsAreReclaimedWhenTheMapIsFull() {
        FixedWindowCounter c = counter(1_000, 2);
        c.increment("a");
        c.increment("b");

        now.addAndGet(1_000);

        assertEquals(1, c.increment("c"), "expired entries make room for new keys");
        assertTrue(c.size() <= 2);
    }

    @Test
    void rejectsNonPositiveConfiguration() {
        assertThrows(IllegalArgumentException.class, () -> new FixedWindowCounter(0, 10));
        assertThrows(IllegalArgumentException.class, () -> new FixedWindowCounter(1000, 0));
    }
}
