package com.example.taskflow.core;

import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

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
    void aFullMapStillTracksNewKeysAndEvictsTheLeastActiveEntry() {
        FixedWindowCounter c = counter(60_000, 3);
        c.increment("victim");
        c.increment("victim");
        c.increment("x");
        c.increment("y");

        // Map is full: a new key is still tracked (a flood must not switch limiting off)...
        assertEquals(1, c.increment("attacker-1"));
        assertEquals(2, c.increment("attacker-1"));
        assertEquals(3, c.size());
        // ...by evicting a low-count entry, never the heavily hit one.
        assertEquals(1, c.increment("attacker-2"));
        assertEquals(3, c.size());
        assertEquals(3, c.increment("victim"));
    }

    /**
     * Making room frees a batch (maxKeys / 64), the least active entries, so the next new keys are
     * recorded without another pass over the map. Making room for each new key cost two passes over
     * all 50,000 entries: 3.4 ms per new key against 18 µs now (BENCHMARKS.md §80).
     */
    @Test
    void aFullMapFreesABatchOfTheLeastActiveEntriesAtOnce() {
        FixedWindowCounter c = counter(60_000, 640); // batch of 10
        for (int i = 0; i < 630; i++) {
            c.increment("quiet-" + i);
        }
        for (int i = 0; i < 10; i++) {
            c.increment("busy-" + i);
            c.increment("busy-" + i);
        }
        assertEquals(640, c.size());

        assertEquals(1, c.increment("new-0"));
        assertEquals(631, c.size(), "ten quiet entries made room, and the new key was recorded");
        for (int i = 1; i < 10; i++) {
            c.increment("new-" + i);
        }
        assertEquals(640, c.size(), "the batch held the next nine new keys");
        for (int i = 0; i < 10; i++) {
            assertEquals(3, c.increment("busy-" + i), "the most active keys are never evicted first");
        }
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
