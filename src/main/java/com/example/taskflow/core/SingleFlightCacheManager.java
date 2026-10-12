package com.example.taskflow.core;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import java.util.Collection;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Adds in-JVM "single flight" loading to every {@link Cache} of the wrapped {@link CacheManager}.
 *
 * <p><b>Why.</b> {@code @Cacheable(sync = true)} makes Spring call {@link Cache#get(Object, Callable)}
 * and rely on the cache to run the loader once per key. {@code ConcurrentMapCache} does; Spring Data
 * Redis' default (non-locking) cache writer does <em>not</em>: concurrent callers that all miss each
 * run the loader and each write, so {@code sync = true} gave no stampede protection against Redis.
 * Locking in Redis ({@code RedisCacheWriter.lockingRedisCacheWriter}) would add a lock round-trip to
 * every read and write, so this decorator serialises loads inside this JVM instead.
 *
 * <p><b>How.</b> A hit is served without any locking. On a miss the caller takes a per-(cache, key)
 * lock, <em>re-checks</em> the cache (a concurrent loader may have filled it while this thread waited),
 * and only then invokes the loader through the delegate. The lock is released in a {@code finally}, so
 * a loader that throws never blocks later callers; different keys use different locks and never block
 * each other. {@link ReentrantLock} is used rather than {@code synchronized} so that waiting virtual
 * threads (enabled in this application) unmount instead of pinning a carrier thread.
 *
 * <p><b>Scope.</b> The protection is per JVM. It fully removes the stampede for the documented
 * single-replica deployment; with N replicas each instance may still run the loader once per expiry
 * (at most N concurrent loads instead of one per request). It is <em>not</em> a distributed lock.
 */
public class SingleFlightCacheManager implements CacheManager {

    private final CacheManager delegate;
    private final ConcurrentMap<String, Cache> caches = new ConcurrentHashMap<>();

    public SingleFlightCacheManager(CacheManager delegate) {
        this.delegate = delegate;
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
        return caches.computeIfAbsent(name, ignored -> new SingleFlightCache(target));
    }

    @Override
    public Collection<String> getCacheNames() {
        return delegate.getCacheNames();
    }

    /** The decorated manager (exposed for tests and diagnostics). */
    public CacheManager getDelegate() {
        return delegate;
    }

    /** A {@link Cache} whose {@code get(key, loader)} runs the loader at most once per key at a time. */
    static final class SingleFlightCache implements Cache {

        /** Reference-counted per-key lock; removed from the map when the last user leaves. */
        private static final class KeyLock {
            final ReentrantLock lock = new ReentrantLock();
            int users;
        }

        private final Cache delegate;
        private final ConcurrentMap<Object, KeyLock> locks = new ConcurrentHashMap<>();

        SingleFlightCache(Cache delegate) {
            this.delegate = delegate;
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
                return delegate.get(key, valueLoader);
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
