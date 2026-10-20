package com.example.taskflow.core;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.support.AbstractValueAdaptingCache;

import java.util.Collection;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;

/**
 * Keeps reads off a failing Redis. After a cache command fails, reads skip Redis for the
 * {@link RedisBackoff} interval: a miss is reported and loaders run directly, so while Redis is down
 * or hung a cached endpoint costs one database query instead of one command timeout per request
 * (with the timeout on every read the catalog served about 2 % of its normal throughput). One read
 * per interval probes Redis and restores the cache once it answers.
 *
 * <p>Writes of loaded values are skipped while backing off. Evictions are always attempted: they are
 * rare, and skipping one would leave a stale entry behind once Redis is back; their errors propagate
 * to the callers, which already tolerate them ({@link FailOpenCacheErrorHandler}, the after-commit
 * eviction listener).
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

        @Override
        public Object getNativeCache() {
            return delegate.getNativeCache();
        }

        @Override
        public ValueWrapper get(Object key) {
            if (!backoff.allowRequest()) {
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
            if (!backoff.allowRequest()) {
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
            if (backoff.allowRequest()) {
                try {
                    T value = delegate.get(key, valueLoader);
                    backoff.recordSuccess();
                    if (value == null && nullValuesNotCached) {
                        // Only a stored value the serializer could not read (an older format) comes back
                        // as null: the Redis writer returns the existing bytes without calling the loader,
                        // so load it here and overwrite the entry instead of serving null until it expires.
                        value = load(key, valueLoader);
                        if (value != null) {
                            delegate.put(key, value);
                        }
                    }
                    return value;
                } catch (ValueRetrievalException e) {
                    throw e; // the loader failed, not the store
                } catch (RuntimeException e) {
                    backoff.recordFailure(e);
                }
            }
            return load(key, valueLoader);
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
            if (!backoff.allowRequest()) {
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
