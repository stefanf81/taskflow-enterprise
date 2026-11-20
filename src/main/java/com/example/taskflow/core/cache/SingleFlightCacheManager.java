package com.example.taskflow.core.cache;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import java.time.Duration;
import java.util.Collection;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutionException;
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
 * <p><b>How.</b> A hit is served without any coordination. On a miss the first caller for a
 * (cache, key) becomes the <em>flight</em>: it re-checks the cache and runs the loader through the
 * delegate. Callers that miss while a flight is under way wait for its outcome instead of loading:
 * its value, or, if it failed, one more flight. A caller whose second flight fails too gets that
 * failure. A waiter used to take the flight's lock after it failed and load again itself, one
 * after another: while the database was down every load waited out the pool's connection timeout,
 * so the n-th caller of a key waited n timeouts (BENCHMARKS.md §80). Now no caller waits longer
 * than two loads, one transient failure still does not fail every waiting caller, and at most one
 * load per key runs at a time. Different keys never wait for each other. Waiting parks a virtual
 * thread (enabled in this application) without pinning its carrier.
 *
 * <p><b>Across replicas.</b> A flight alone is per JVM: with N replicas each instance could
 * still run the loader once per expiry. When a {@link DistributedLoadLock} is configured
 * ({@code app.state.store=redis}, see {@link RedisCacheLoadLock}), the flight
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
 * Hits never touch a flight or the lease; only misses of {@code get(key, loader)}
 * ({@code @Cacheable(sync = true)}) do.
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

        /** One load of one key, and the thread running it; its outcome goes to every waiter. */
        private static final class Flight {
            final CompletableFuture<Object> outcome = new CompletableFuture<>();
            final Thread loader = Thread.currentThread();
        }

        private final Cache delegate;
        private final DistributedLoadLock distributedLock;
        private final long maxWaitNanos;
        private final ConcurrentMap<Object, Flight> flights = new ConcurrentHashMap<>();

        SingleFlightCache(Cache delegate, DistributedLoadLock distributedLock, long maxWaitNanos) {
            this.delegate = delegate;
            this.distributedLock = distributedLock;
            this.maxWaitNanos = maxWaitNanos;
        }

        /** The decorated cache (the back-off cache around the Redis cache), for the cache metrics. */
        Cache getDelegate() {
            return delegate;
        }

        @Override
        public <T> T get(Object key, Callable<T> valueLoader) {
            ValueWrapper hit = delegate.get(key);
            if (hit != null) {
                return cast(hit.get());
            }
            boolean retried = false;
            while (true) {
                Flight mine = new Flight();
                Flight running = flights.putIfAbsent(key, mine);
                if (running == null) {
                    return fly(key, valueLoader, mine);
                }
                if (running.loader == Thread.currentThread()) {
                    // The loader asks for its own key: waiting for itself would never end.
                    return delegate.get(key, valueLoader);
                }
                try {
                    return cast(running.outcome.get());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new ValueRetrievalException(key, valueLoader, e);
                } catch (ExecutionException e) {
                    if (retried) {
                        throw rethrow(e.getCause());
                    }
                    retried = true; // one more flight; a value stored meanwhile is found by it
                }
            }
        }

        /** Runs the load as this key's flight and hands its outcome to everyone waiting for it. */
        private <T> T fly(Object key, Callable<T> valueLoader, Flight flight) {
            try {
                // Re-check: the previous flight may have stored the value since this caller missed.
                ValueWrapper stored = delegate.get(key);
                T value = stored != null
                        ? cast(stored.get())
                        : distributedLock == null
                                ? delegate.get(key, valueLoader)
                                : loadUnderDistributedLock(key, valueLoader);
                flight.outcome.complete(value);
                return value;
            } catch (RuntimeException | Error e) {
                flight.outcome.completeExceptionally(e);
                throw e;
            } finally {
                flights.remove(key, flight);
            }
        }

        @SuppressWarnings("unchecked")
        private static <T> T cast(Object value) {
            return (T) value;
        }

        private static RuntimeException rethrow(Throwable failure) {
            if (failure instanceof RuntimeException runtime) {
                return runtime;
            }
            if (failure instanceof Error error) {
                throw error;
            }
            return new IllegalStateException(failure);
        }

        /**
         * Runs as this key's flight, so at most one thread per JVM gets here per key. See the class
         * comment for the protocol.
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

        /** Number of keys with a load under way (for tests: must return to 0). */
        int activeLockCount() {
            return flights.size();
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
