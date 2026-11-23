package com.example.taskflow.core.cache;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.taskflow.core.redis.RedisBackoff;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.concurrent.ConcurrentMapCache;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.data.redis.RedisConnectionFailureException;

/** While the store fails, reads skip it for the back-off interval and loaders run directly. */
class RedisBackoffCacheManagerTest {

    private final AtomicLong now = new AtomicLong(1_000);
    private final RedisBackoff backoff = new RedisBackoff("test", 5_000, now::get);
    private final FlakyCache store = new FlakyCache("things");
    private final Cache cache = new RedisBackoffCacheManager(new SingleCacheManager(store), backoff).getCache("things");
    private final AtomicInteger loads = new AtomicInteger();
    private final Callable<String> loader = () -> "value-" + loads.incrementAndGet();

    @Test
    void anUnreadableStoredValueIsLoadedAndOverwrittenInsteadOfServedAsNull() {
        StaleFormatCache stale = new StaleFormatCache("things");
        stale.put("k", StaleFormatCache.UNREADABLE);
        Cache wrapped = new RedisBackoffCacheManager(new SingleCacheManager(stale), backoff).getCache("things");

        assertEquals("value-1", wrapped.get("k", loader));
        assertEquals("value-1", wrapped.get("k", loader), "overwritten: the second read is a hit");
        assertEquals(1, loads.get());
    }

    @Test
    void aFailedOverwriteOfAnUnreadableValueDoesNotLoadTwice() {
        StaleFormatCache stale = new StaleFormatCache("things");
        stale.put("k", StaleFormatCache.UNREADABLE);
        stale.failPuts.set(true);
        Cache wrapped = new RedisBackoffCacheManager(new SingleCacheManager(stale), backoff).getCache("things");

        assertEquals("value-1", wrapped.get("k", loader));
        assertEquals(1, loads.get(), "the write failed, the loaded value is still returned once");
        assertEquals("value-2", wrapped.get("k", loader), "backing off: loaded directly");
    }

    @Test
    void healthyStoreCaches() {
        assertEquals("value-1", cache.get("k", loader));
        assertEquals("value-1", cache.get("k", loader));
        assertEquals(1, loads.get(), "the second read is a hit");
    }

    @Test
    void failingStoreIsSkippedUntilTheIntervalEnds() {
        store.down.set(true);

        assertEquals("value-1", cache.get("k", loader), "the failing read falls back to the loader");
        int callsAfterFailure = store.calls.get();
        assertEquals("value-2", cache.get("k", loader));
        assertNull(cache.get("k"));
        cache.put("k", "x");
        assertEquals(callsAfterFailure, store.calls.get(), "no store calls while backing off");

        store.down.set(false);
        now.addAndGet(5_000);
        assertEquals("value-3", cache.get("k", loader), "the probe reaches the store again");
        assertEquals("value-3", cache.get("k", loader), "and caching is back");
    }

    @Test
    void loaderFailuresStillPropagate() {
        Callable<String> failing = () -> {
            throw new IllegalStateException("db down");
        };
        assertThrows(Cache.ValueRetrievalException.class, () -> cache.get("k", failing));

        store.down.set(true);
        cache.get("other", loader); // trips the back-off
        assertThrows(Cache.ValueRetrievalException.class, () -> cache.get("k", failing));
    }

    /**
     * While backing off, an eviction does not wait for a hung Redis (it used to cost every booking a
     * command timeout); the cache is cleared as a whole before Redis serves it again, so the entry the
     * eviction was meant for is never served stale.
     */
    @Test
    void anEvictionDuringTheBackoffIsSkippedAndTheCacheIsClearedWhenRedisIsBack() {
        cache.put("k", "stale");
        cache.put("other", "stale too");
        store.down.set(true);
        cache.get("k"); // trips the back-off
        int callsAfterFailure = store.calls.get();

        assertFalse(cache.evictIfPresent("k"));
        cache.evict("k");
        assertFalse(cache.invalidate());

        assertEquals(callsAfterFailure, store.calls.get(), "no store calls while backing off");
        store.down.set(false);
        assertEquals("stale", store.lookupRaw("k"), "the skipped eviction left the entry in the store");
        now.addAndGet(5_000);

        assertEquals("value-1", cache.get("k", loader), "cleared before the first read: not the stale value");
        assertNull(store.lookupRaw("other"), "the whole cache was cleared, not just one key");
        assertEquals("value-1", cache.get("k", loader), "caching works again");
    }

    /** A failing eviction is recorded, not thrown (callers logged an ERROR for each one). */
    @Test
    void aFailedEvictionIsNotThrownAndTheCacheIsClearedOnRecovery() {
        cache.put("k", "stale");
        store.down.set(true);

        assertDoesNotThrow(() -> cache.evictIfPresent("k"));

        store.down.set(false);
        now.addAndGet(5_000);
        assertEquals("value-1", cache.get("k", loader), "the missed eviction cleared the cache on recovery");
    }

    @Test
    void aHealthyEvictionRemovesOnlyItsKey() {
        cache.put("k", "v");
        cache.put("other", "kept");

        assertTrue(cache.evictIfPresent("k"));

        assertNull(store.lookupRaw("k"));
        assertEquals("kept", store.lookupRaw("other"));
    }

    private static final class SingleCacheManager extends ConcurrentMapCacheManager {
        private final Cache cache;

        SingleCacheManager(Cache cache) {
            this.cache = cache;
        }

        @Override
        public Cache getCache(String name) {
            return cache;
        }
    }

    /**
     * Like a {@code RedisCache} holding an entry its serializer cannot read (an older format):
     * {@code get(key)} misses and {@code get(key, loader)} returns null without calling the loader.
     */
    private static final class StaleFormatCache extends ConcurrentMapCache {
        static final Object UNREADABLE = new Object();
        final AtomicBoolean failPuts = new AtomicBoolean();

        StaleFormatCache(String name) {
            super(name, false);
        }

        @Override
        public void put(Object key, Object value) {
            if (failPuts.get()) {
                throw new RedisConnectionFailureException("Redis command timed out");
            }
            super.put(key, value);
        }

        @Override
        protected Object lookup(Object key) {
            Object value = super.lookup(key);
            return value == UNREADABLE ? null : value;
        }

        @Override
        public <T> T get(Object key, Callable<T> valueLoader) {
            return super.lookup(key) == UNREADABLE ? null : super.get(key, valueLoader);
        }
    }

    /** A cache that fails like an unreachable Redis while {@link #down} is set. */
    private static final class FlakyCache extends ConcurrentMapCache {
        final AtomicBoolean down = new AtomicBoolean();
        final AtomicInteger calls = new AtomicInteger();

        FlakyCache(String name) {
            super(name);
        }

        private void touch() {
            calls.incrementAndGet();
            if (down.get()) {
                throw new RedisConnectionFailureException("Redis command timed out");
            }
        }

        Object lookupRaw(Object key) {
            return super.lookup(key);
        }

        @Override
        public ValueWrapper get(Object key) {
            touch();
            return super.get(key);
        }

        @Override
        public <T> T get(Object key, Callable<T> valueLoader) {
            touch();
            return super.get(key, valueLoader);
        }

        @Override
        public void put(Object key, Object value) {
            touch();
            super.put(key, value);
        }

        @Override
        public void evict(Object key) {
            touch();
            super.evict(key);
        }

        @Override
        public boolean evictIfPresent(Object key) {
            touch();
            return super.evictIfPresent(key);
        }

        @Override
        public boolean invalidate() {
            touch();
            return super.invalidate();
        }
    }
}
