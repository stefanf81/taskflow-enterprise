package com.example.taskflow.core.cache;
import com.example.taskflow.core.redis.RedisBackoff;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.support.AbstractValueAdaptingCache;

import java.util.Collection;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/**
 * Keeps reads off a failing Redis. After a cache command fails, reads skip Redis for the
 * {@link RedisBackoff} interval: a miss is reported and loaders run directly, so while Redis is down
 * or hung a cached endpoint costs one database query instead of one command timeout per request
 * (with the timeout on every read the catalog served about 2 % of its normal throughput). One read
 * per interval probes Redis and restores the cache once it answers.
 *
 * <p>Writes of loaded values are skipped while backing off, and so are evictions: attempting each one
 * cost every booking or status change a full command timeout (17 → 272 ms with Redis hung) plus an
 * ERROR log line (BENCHMARKS.md §75). A cache that skipped (or failed) an eviction is marked, and
 * the first call allowed to use Redis again clears that whole cache before anything else, so no
 * stale entry outlives the outage; that also closes the stale-after-outage window ADR-018 accepted.
 * A failed eviction is recorded like any other failure instead of being thrown.
 */
final class RedisBackoffCacheManager implements CacheManager {

    private final CacheManager delegate;
    private final RedisBackoff backoff;
    private final ConcurrentMap<String, Cache> caches = new ConcurrentHashMap<>();

    RedisBackoffCacheManager(CacheManager delegate, RedisBackoff backoff) {
        this.delegate = delegate;
        this.backoff = backoff;
    }

    @Override
    public Cache getCache(String name) {
        Cache cached = caches.get(name);
        if (cached != null) {
            return cached;
        }
        Cache target = delegate.getCache(name);
        return target == null ? null : caches.computeIfAbsent(name, n -> new BackoffCache(target, backoff));
    }

    @Override
    public Collection<String> getCacheNames() {
        return delegate.getCacheNames();
    }

    CacheManager getDelegate() {
        return delegate;
    }

    static final class BackoffCache implements Cache {

        private final Cache delegate;
        private final RedisBackoff backoff;
        /** Every Redis cache here disables null values, so a null from get(key, loader) means unreadable. */
        private final boolean nullValuesNotCached;
        /** An eviction was skipped or failed: the whole cache is cleared before Redis is used again. */
        private final AtomicBoolean missedEviction = new AtomicBoolean();

        BackoffCache(Cache delegate, RedisBackoff backoff) {
            this.delegate = delegate;
            this.backoff = backoff;
            this.nullValuesNotCached = delegate instanceof AbstractValueAdaptingCache adapting
                    && !adapting.isAllowNullValues();
        }

        @Override
        public String getName() {
            return delegate.getName();
        }

        /** The decorated cache (the Redis cache), for the cache metrics. */
        Cache getDelegate() {
            return delegate;
        }

        @Override
        public Object getNativeCache() {
            return delegate.getNativeCache();
        }

        @Override
        public ValueWrapper get(Object key) {
            if (!redisUsable()) {
                return null;
            }
            try {
                ValueWrapper value = delegate.get(key);
                backoff.recordSuccess();
                return value;
            } catch (RuntimeException e) {
                backoff.recordFailure(e);
                return null;
            }
        }

        @Override
        public <T> T get(Object key, Class<T> type) {
            if (!redisUsable()) {
                return null;
            }
            try {
                T value = delegate.get(key, type);
                backoff.recordSuccess();
                return value;
            } catch (IllegalStateException e) {
                throw e; // stored value of another type: not a store failure
            } catch (RuntimeException e) {
                backoff.recordFailure(e);
                return null;
            }
        }

        @Override
        public <T> T get(Object key, Callable<T> valueLoader) {
            if (!redisUsable()) {
                return load(key, valueLoader);
            }
            T value;
            try {
                value = delegate.get(key, valueLoader);
                backoff.recordSuccess();
            } catch (ValueRetrievalException e) {
                throw e; // the loader failed, not the store
            } catch (RuntimeException e) {
                backoff.recordFailure(e);
                return load(key, valueLoader);
            }
            if (value == null && nullValuesNotCached) {
                // Only a stored value the serializer could not read (an older format) comes back
                // as null: the Redis writer returns the existing bytes without calling the loader,
                // so load it here and overwrite the entry instead of serving null until it expires.
                // The overwrite goes through put(): a failed write is a store failure, it must not
                // run the loader a second time.
                value = load(key, valueLoader);
                if (value != null) {
                    put(key, value);
                }
            }
            return value;
        }

        private static <T> T load(Object key, Callable<T> valueLoader) {
            try {
                return valueLoader.call();
            } catch (Exception e) {
                throw new ValueRetrievalException(key, valueLoader, e);
            }
        }

        @Override
        public void put(Object key, Object value) {
            if (!redisUsable()) {
                return;
            }
            try {
                delegate.put(key, value);
                backoff.recordSuccess();
            } catch (RuntimeException e) {
                backoff.recordFailure(e);
            }
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
        public void evict(Object key) {
            evicting(() -> {
                delegate.evict(key);
                return false;
            });
        }

        @Override
        public boolean evictIfPresent(Object key) {
            return evicting(() -> delegate.evictIfPresent(key));
        }

        @Override
        public void clear() {
            evicting(() -> {
                delegate.clear();
                return false;
            });
        }

        @Override
        public boolean invalidate() {
            return evicting(delegate::invalidate);
        }

        /**
         * Runs an eviction unless Redis is being skipped; a skipped or failed one marks the cache so
         * it is cleared as a whole before Redis serves it again. Returns false when nothing was done.
         */
        private boolean evicting(java.util.function.BooleanSupplier eviction) {
            if (!redisUsable()) {
                missedEviction.set(true);
                return false;
            }
            try {
                boolean result = eviction.getAsBoolean();
                backoff.recordSuccess();
                return result;
            } catch (RuntimeException e) {
                missedEviction.set(true);
                backoff.recordFailure(e);
                return false;
            }
        }

        /**
         * Whether this call may use Redis now ({@link RedisBackoff#allowRequest()}). If an eviction was
         * missed meanwhile, the cache is cleared first. The mark is taken before clearing, so an
         * eviction skipped while the clear runs marks the cache again rather than being lost.
         */
        private boolean redisUsable() {
            if (!backoff.allowRequest()) {
                return false;
            }
            if (missedEviction.getAndSet(false)) {
                try {
                    delegate.invalidate();
                    backoff.recordSuccess();
                } catch (RuntimeException e) {
                    missedEviction.set(true);
                    backoff.recordFailure(e);
                    return false;
                }
            }
            return true;
        }
    }
}
