package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCache;
import org.springframework.cache.support.SimpleCacheManager;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

/** A failing cache store must turn into a cache miss, not a failed request. */
class FailOpenCacheErrorHandlerTest {

    @Test
    void cacheableMethodsStillAnswerWhileTheStoreFails() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext(Setup.class)) {
            Service service = context.getBean(Service.class);

            assertEquals("value-1", service.load("k"), "sync=true read falls back to the method");
            assertEquals("value-2", service.load("k"), "nothing was cached: the store is down");
            assertDoesNotThrow(() -> service.evict("k"));
        }
    }

    @Test
    void reportsAreRateLimited() {
        AtomicLong now = new AtomicLong(1_000);
        FailOpenCacheErrorHandler handler = new FailOpenCacheErrorHandler(now::get);
        Cache cache = new ConcurrentMapCache("c");
        RuntimeException failure = new RedisConnectionFailureException("down");

        // Must not throw in any phase of the window; the logging itself is fire-and-forget.
        assertDoesNotThrow(() -> {
            handler.handleCacheGetError(failure, cache, "k");
            handler.handleCachePutError(failure, cache, "k", "v");
            now.addAndGet(FailOpenCacheErrorHandler.LOG_INTERVAL_MILLIS);
            handler.handleCacheEvictError(failure, cache, "k");
            handler.handleCacheClearError(failure, cache);
        });
    }

    @Configuration
    @EnableCaching
    @Import(CacheErrorHandlingConfig.class)
    static class Setup {
        @Bean
        CacheManager cacheManager() {
            SimpleCacheManager manager = new SimpleCacheManager();
            manager.setCaches(List.of(new BrokenCache("things")));
            return manager;
        }

        @Bean
        Service service() {
            return new Service();
        }
    }

    static class Service {
        private final AtomicInteger calls = new AtomicInteger();

        @Cacheable(value = "things", sync = true)
        public String load(String key) {
            return "value-" + calls.incrementAndGet();
        }

        @CacheEvict(value = "things")
        public void evict(String key) {
        }
    }

    /** A cache whose store is unreachable, like Redis while it is down or hung. */
    static class BrokenCache extends ConcurrentMapCache {
        BrokenCache(String name) {
            super(name);
        }

        @Override
        public ValueWrapper get(Object key) {
            throw new RedisConnectionFailureException("Redis command timed out");
        }

        @Override
        public <T> T get(Object key, Callable<T> valueLoader) {
            throw new RedisConnectionFailureException("Redis command timed out");
        }

        @Override
        public void put(Object key, Object value) {
            throw new RedisConnectionFailureException("Redis command timed out");
        }

        @Override
        public void evict(Object key) {
            throw new RedisConnectionFailureException("Redis command timed out");
        }
    }
}
