package com.example.taskflow.core;

import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * Bounded, in-memory fixed-window counter keyed by an arbitrary string.
 *
 * <p>Used where a shared Redis counter is unavailable or inappropriate: the
 * rate limiter's fallback while Redis is failing, and per-account login-failure
 * throttling. Counters are per JVM, which matches the documented single-replica
 * deployment.
 *
 * <p>Memory is capped at {@code maxKeys}. When the map is full, expired windows
 * are purged first; if it is still full, <em>new</em> keys are left untracked
 * (their count reads as 0) rather than evicting live counters, so a flood of
 * unique keys cannot reset an existing key's count.
 */
public final class FixedWindowCounter {

    private record Window(long startMillis, long count) {}

    private final long windowMillis;
    private final int maxKeys;
    private final LongSupplier clock;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    public FixedWindowCounter(long windowMillis, int maxKeys) {
        this(windowMillis, maxKeys, System::currentTimeMillis);
    }

    FixedWindowCounter(long windowMillis, int maxKeys, LongSupplier clock) {
        if (windowMillis <= 0 || maxKeys <= 0) {
            throw new IllegalArgumentException("windowMillis and maxKeys must be positive");
        }
        this.windowMillis = windowMillis;
        this.maxKeys = maxKeys;
        this.clock = clock;
    }

    /** Records one event for {@code key} and returns the count in the current window. */
    public long increment(String key) {
        long now = clock.getAsLong();
        if (windows.size() >= maxKeys && !windows.containsKey(key)) {
            purgeExpired(now);
            if (windows.size() >= maxKeys) {
                return 0;
            }
        }
        return windows.compute(key, (k, w) ->
                (w == null || now - w.startMillis() >= windowMillis)
                        ? new Window(now, 1)
                        : new Window(w.startMillis(), w.count() + 1)).count();
    }

    /** Returns the count in the current window without recording an event. */
    public long current(String key) {
        Window w = windows.get(key);
        if (w == null || clock.getAsLong() - w.startMillis() >= windowMillis) {
            return 0;
        }
        return w.count();
    }

    /** Seconds until the current window for {@code key} ends (at least 1). */
    public long secondsUntilReset(String key) {
        Window w = windows.get(key);
        if (w == null) {
            return 1;
        }
        long remaining = windowMillis - (clock.getAsLong() - w.startMillis());
        return Math.max(1, (remaining + 999) / 1000);
    }

    public void reset(String key) {
        windows.remove(key);
    }

    int size() {
        return windows.size();
    }

    private void purgeExpired(long now) {
        windows.values().removeIf(w -> now - w.startMillis() >= windowMillis);
    }
}
