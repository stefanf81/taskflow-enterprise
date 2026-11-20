package com.example.taskflow.core;

import java.util.Comparator;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.LongSupplier;

/**
 * Bounded, in-memory fixed-window counter keyed by an arbitrary string.
 *
 * <p>Used where a shared Redis counter is unavailable or inappropriate: the
 * rate limiter's fallback while Redis is failing, and per-account login-failure
 * throttling (the whole state with {@code app.state.store=memory}, the fallback
 * with {@code redis}). Counters are per JVM: with N replicas a limit enforced
 * only here allows up to N times the configured count.
 *
 * <p>Memory is capped at {@code maxKeys}. When the map is full, expired windows
 * are purged first; if it is still full, the live entry with the <em>lowest</em>
 * count (oldest window on ties) is evicted to make room. New keys are therefore
 * always tracked — leaving them untracked would let a flood of throwaway keys
 * switch the limit off for every key not already in the map — while a key that
 * is actually being hammered has a high count and is the last to be evicted.
 *
 * <p>Making room costs a pass over the map, so it frees a batch at once: the least active
 * {@code maxKeys / 64} entries (at least one), after the expired ones. One pass then pays for that
 * many new keys. It used to run two full passes (purge, then find the single least active entry)
 * for every new key once the map was full: at the rate limiter's 50,000 keys, a flood of new
 * addresses or login names cost two 50,000-entry scans per request (BENCHMARKS.md §80). One
 * thread makes room at a time; the others record their key meanwhile, so the map can exceed
 * {@code maxKeys} by the number of concurrent callers.
 */
public final class FixedWindowCounter {

    private record Window(long startMillis, long count) {}

    private final long windowMillis;
    private final int maxKeys;
    private final LongSupplier clock;
    private final int evictionBatch;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    private final ReentrantLock makingRoom = new ReentrantLock();

    /** Least active first: the lowest count, then the oldest window. */
    private static final Comparator<Map.Entry<String, Window>> LEAST_ACTIVE_FIRST =
            Comparator.comparingLong((Map.Entry<String, Window> e) -> e.getValue().count())
                    .thenComparingLong(e -> e.getValue().startMillis());

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
        this.evictionBatch = Math.max(1, maxKeys / 64);
    }

    /** Records one event for {@code key} and returns the count in the current window. */
    public long increment(String key) {
        long now = clock.getAsLong();
        if (windows.size() >= maxKeys && !windows.containsKey(key)) {
            makeRoom(now);
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

    private void makeRoom(long now) {
        if (!makingRoom.tryLock()) {
            return; // another caller is making room
        }
        try {
            if (windows.size() < maxKeys) {
                return;
            }
            windows.values().removeIf(w -> now - w.startMillis() >= windowMillis);
            int excess = windows.size() - (maxKeys - evictionBatch);
            if (excess > 0) {
                evictLeastActive(excess);
            }
        } finally {
            makingRoom.unlock();
        }
    }

    /** Removes the {@code count} least active entries, in one pass (a heap of {@code count}). */
    private void evictLeastActive(int count) {
        PriorityQueue<Map.Entry<String, Window>> leastActive =
                new PriorityQueue<>(count + 1, LEAST_ACTIVE_FIRST.reversed());
        for (Map.Entry<String, Window> entry : windows.entrySet()) {
            leastActive.add(Map.entry(entry.getKey(), entry.getValue()));
            if (leastActive.size() > count) {
                leastActive.poll(); // drop the most active candidate
            }
        }
        for (Map.Entry<String, Window> entry : leastActive) {
            windows.remove(entry.getKey(), entry.getValue());
        }
    }
}
