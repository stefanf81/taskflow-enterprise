package com.example.taskflow.core;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import java.time.Duration;
import java.util.Collection;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Adds "single flight" loading to every {@link Cache} of the wrapped {@link CacheManager}.
 *
 * <p><b>Why.</b> {@code @Cacheable(sync = true)} makes Spring call {@link Cache#get(Object, Callable)}
 * and rely on the cache to run the loader once per key. {@code ConcurrentMapCache} does; Spring Data
 * Redis' default (non-locking) cache writer does <em>not</em>: concurrent callers that all miss each
 * run the loader and each write, so {@code sync = true} gave no stampede protection against Redis.
 * Spring Data Redis' locking writer ({@code RedisCacheWriter.lockingRedisCacheWriter}) would add a
 * lock round-trip to every read and write (and locks the whole cache, not a key), so this decorator
 * serialises loads inside this JVM and, optionally, takes a per-key Redis lease on misses only.
 *
 * <p><b>How.</b> A hit is served without any locking. On a miss the caller takes a per-(cache, key)
 * lock, <em>re-checks</em> the cache (a concurrent loader may have filled it while this thread waited),
 * and only then invokes the loader through the delegate. The lock is released in a {@code finally}, so
 * a loader that throws never blocks later callers; different keys use different locks and never block
 * each other. {@link ReentrantLock} is used rather than {@code synchronized} so that waiting virtual
 * threads (enabled in this application) unmount instead of pinning a carrier thread.
 *
 * <p><b>Across replicas.</b> The local lock alone is per JVM: with N replicas each instance could
 * still run the loader once per expiry. When a {@link DistributedLoadLock} is configured
 * ({@code app.state.store=redis}, see {@link RedisCacheLoadLock}), the thread holding the local lock
 * additionally takes a Redis lease for the key before loading, so one JVM sends one lock attempt and
 * the whole deployment runs the loader once:
 * <ul>
 *   <li>the winner re-checks the cache, loads, writes the value and releases its own lease;</li>
 *   <li>losers poll the cache with a short exponential backoff, re-trying the lease each round (a
 *       winner whose load failed releases the lease, so a loser takes over at once), and after
 *       {@code maxWait} load the value themselves (a winner that died keeps the lease until it
 *       expires; a winner slower than {@code maxWait} costs one extra load per waiting replica);</li>
 *   <li>any Redis error on the lock falls back to the local-only behaviour: load directly.</li>
 * </ul>
 * Hits never touch the lock; only misses of {@code get(key, loader)} ({@code @Cacheable(sync = true)})
 * do.
 */
class SingleFlightCacheManager implements CacheManager {

    /**
     * A cross-process lease on one cache key. {@link #tryAcquire} returns a token when this caller
     * now holds the lease, {@code null} when another holder has it, and throws when the lock store
     * cannot be used (the caller then loads without it).
     */
    public interface DistributedLoadLock {

        String tryAcquire(String cacheName, Object key);

        /** Releases the lease only if {@code token} still owns it. Must not throw. */
        void release(String cacheName, Object key, String token);
    }

    /** Default bound on how long a loser waits for another replica's load. */
    public static final Duration DEFAULT_MAX_WAIT = Duration.ofSeconds(5);
    private static final long FIRST_POLL_MILLIS = 10;
    private static final long MAX_POLL_MILLIS = 200;

    private final CacheManager delegate;
    private final DistributedLoadLock distributedLock;
    private final long maxWaitNanos;
    private final ConcurrentMap<String, Cache> caches = new ConcurrentHashMap<>();

    public SingleFlightCacheManager(CacheManager delegate) {
        this(delegate, null, DEFAULT_MAX_WAIT);
    }

    /**
     * @param distributedLock cross-replica lease, or {@code null} for per-JVM single flight only
     * @param maxWait how long a caller that lost the lease waits for the winner's value
     */
    public SingleFlightCacheManager(CacheManager delegate, DistributedLoadLock distributedLock, Duration maxWait) {
        this.delegate = delegate;
        this.distributedLock = distributedLock;
        this.maxWaitNanos = Math.max(0, maxWait.toNanos());
    }

    @Override
    public Cache getCache(String name) {
        Cache cache = caches.get(name);
        if (cache != null) {
            return cache;
        }
        Cache target = delegate.getCache(name);
        if (target == null) {
            return null;
        }
        return caches.computeIfAbsent(name, ignored -> new SingleFlightCache(target, distributedLock, maxWaitNanos));
    }

    @Override
    public Collection<String> getCacheNames() {
        return delegate.getCacheNames();
    }

    /** The decorated manager (exposed for tests and diagnostics). */
    public CacheManager getDelegate() {
        return delegate;
    }

    /** The cross-replica lock, or {@code null} when single flight is per JVM only. */
    public DistributedLoadLock getDistributedLock() {
        return distributedLock;
    }

    /** A {@link Cache} whose {@code get(key, loader)} runs the loader at most once per key at a time. */
    static final class SingleFlightCache implements Cache {

        /** Reference-counted per-key lock; removed from the map when the last user leaves. */
        private static final class KeyLock {
            final ReentrantLock lock = new ReentrantLock();
            int users;
        }

        private final Cache delegate;
        private final DistributedLoadLock distributedLock;
        private final long maxWaitNanos;
        private final ConcurrentMap<Object, KeyLock> locks = new ConcurrentHashMap<>();

        SingleFlightCache(Cache delegate, DistributedLoadLock distributedLock, long maxWaitNanos) {
            this.delegate = delegate;
            this.distributedLock = distributedLock;
            this.maxWaitNanos = maxWaitNanos;
        }

        @Override
        public <T> T get(Object key, Callable<T> valueLoader) {
            ValueWrapper hit = delegate.get(key);
            if (hit != null) {
                @SuppressWarnings("unchecked")
                T value = (T) hit.get();
                return value;
            }

            KeyLock keyLock = locks.compute(key, (k, existing) -> {
                KeyLock lock = existing != null ? existing : new KeyLock();
                lock.users++;
                return lock;
            });
            keyLock.lock.lock();
            try {
                // Re-check: a thread that waited for the lock must find the value stored by the
                // previous holder instead of loading it again. Done here rather than relying on the
                // delegate's get(key, loader) so correctness does not depend on its implementation.
                ValueWrapper stored = delegate.get(key);
                if (stored != null) {
                    @SuppressWarnings("unchecked")
                    T value = (T) stored.get();
                    return value;
                }
                return distributedLock == null
                        ? delegate.get(key, valueLoader)
                        : loadUnderDistributedLock(key, valueLoader);
            } finally {
                keyLock.lock.unlock();
                locks.compute(key, (k, existing) -> {
                    if (existing == null) {
                        return null;
                    }
                    existing.users--;
                    return existing.users == 0 ? null : existing;
                });
            }
        }

        /**
         * Runs with this JVM's per-key lock held, so at most one thread per JVM gets here per key.
         * See the class comment for the protocol.
         */
        private <T> T loadUnderDistributedLock(Object key, Callable<T> valueLoader) {
            String name = delegate.getName();
            long deadline = System.nanoTime() + maxWaitNanos;
            long pollMillis = FIRST_POLL_MILLIS;
            while (true) {
                String token;
                try {
                    token = distributedLock.tryAcquire(name, key);
                } catch (RuntimeException e) {
                    return delegate.get(key, valueLoader); // lock store unusable: local-only
                }
                if (token != null) {
                    try {
                        // A previous lease holder may have written the value just before we got in.
                        ValueWrapper stored = delegate.get(key);
                        if (stored != null) {
                            @SuppressWarnings("unchecked")
                            T value = (T) stored.get();
                            return value;
                        }
                        return delegate.get(key, valueLoader);
                    } finally {
                        distributedLock.release(name, key, token);
                    }
                }
                long remainingNanos = deadline - System.nanoTime();
                if (remainingNanos <= 0) {
                    return delegate.get(key, valueLoader); // winner too slow or gone: load ourselves
                }
                try {
                    Thread.sleep(Math.min(pollMillis, Math.max(1, remainingNanos / 1_000_000)));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return delegate.get(key, valueLoader);
                }
                pollMillis = Math.min(pollMillis * 2, MAX_POLL_MILLIS);
                ValueWrapper published = delegate.get(key);
                if (published != null) {
                    @SuppressWarnings("unchecked")
                    T value = (T) published.get();
                    return value;
                }
            }
        }

        /** Number of keys that currently have a lock entry (for tests: must return to 0). */
        int activeLockCount() {
            return locks.size();
        }

        @Override
        public String getName() {
            return delegate.getName();
        }

        @Override
        public Object getNativeCache() {
            return delegate.getNativeCache();
        }

        @Override
        public ValueWrapper get(Object key) {
            return delegate.get(key);
        }

        @Override
        public <T> T get(Object key, Class<T> type) {
            return delegate.get(key, type);
        }

        @Override
        public CompletableFuture<?> retrieve(Object key) {
            return delegate.retrieve(key);
        }

        @Override
        public <T> CompletableFuture<T> retrieve(Object key, Supplier<CompletableFuture<T>> valueLoader) {
            return delegate.retrieve(key, valueLoader);
        }

        @Override
        public void put(Object key, Object value) {
            delegate.put(key, value);
        }

        @Override
        public ValueWrapper putIfAbsent(Object key, Object value) {
            return delegate.putIfAbsent(key, value);
        }

        @Override
        public void evict(Object key) {
            delegate.evict(key);
        }

        @Override
        public boolean evictIfPresent(Object key) {
            return delegate.evictIfPresent(key);
        }

        @Override
        public void clear() {
            delegate.clear();
        }

        @Override
        public boolean invalidate() {
            return delegate.invalidate();
        }
    }
}
