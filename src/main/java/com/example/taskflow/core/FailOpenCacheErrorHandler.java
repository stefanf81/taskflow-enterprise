package com.example.taskflow.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.interceptor.CacheErrorHandler;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * Treats a failing cache store (Redis down or hung) as a cache miss instead of a failed request.
 *
 * <p>Without it every {@code @Cacheable} read propagated the Redis error: with Redis hung, the public
 * catalog, barber list and busy-slot endpoints answered nothing but 503 although PostgreSQL was fine.
 * Spring calls the method itself after a failed read; a failed write or eviction is skipped, so a
 * mutation made during an outage can leave a stale entry until its TTL (at most 10 minutes; bookings
 * are re-validated in their own transaction, never from the cache).
 *
 * <p>Logs the first failure and then at most one line per {@link #LOG_INTERVAL_MILLIS} with the number
 * of failures in between: one line per request would flood the blocking log queue during an outage.
 */
final class FailOpenCacheErrorHandler implements CacheErrorHandler {

    private static final Logger log = LoggerFactory.getLogger(FailOpenCacheErrorHandler.class);

    static final long LOG_INTERVAL_MILLIS = 30_000;

    private final LongSupplier clock;
    private final AtomicLong nextLogAtMillis = new AtomicLong(Long.MIN_VALUE);
    private final AtomicLong suppressed = new AtomicLong();

    FailOpenCacheErrorHandler() {
        this(System::currentTimeMillis);
    }

    FailOpenCacheErrorHandler(LongSupplier clock) {
        this.clock = clock;
    }

    @Override
    public void handleCacheGetError(RuntimeException exception, Cache cache, Object key) {
        report("read", cache, exception);
    }

    @Override
    public void handleCachePutError(RuntimeException exception, Cache cache, Object key, Object value) {
        report("write", cache, exception);
    }

    @Override
    public void handleCacheEvictError(RuntimeException exception, Cache cache, Object key) {
        report("eviction", cache, exception);
    }

    @Override
    public void handleCacheClearError(RuntimeException exception, Cache cache) {
        report("clear", cache, exception);
    }

    private void report(String operation, Cache cache, RuntimeException exception) {
        long now = clock.getAsLong();
        long next = nextLogAtMillis.get();
        if (now >= next && nextLogAtMillis.compareAndSet(next, now + LOG_INTERVAL_MILLIS)) {
            log.warn("Cache {} failed on '{}'; serving without the cache ({} similar failures since the last report): {}",
                    operation, cache.getName(), suppressed.getAndSet(0), LogSanitizer.safeMessage(exception));
        } else {
            suppressed.incrementAndGet();
        }
    }
}
