package com.example.taskflow.core.cache;

import io.micrometer.core.instrument.Tag;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.boot.cache.metrics.CacheMeterBinderProvider;
import org.springframework.boot.cache.metrics.RedisCacheMeterBinderProvider;
import org.springframework.cache.Cache;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCache;

/**
 * Micrometer cache metrics ({@code cache.gets{result=hit|miss}}, {@code cache.puts},
 * {@code cache.removals} (evictions), per {@code cache} and {@code cacheManager} tag) for the Redis caches.
 *
 * <p>Spring Boot binds them for every cache of a {@code CacheManager} bean, but only for caches it
 * recognises, and {@link CacheConfig} wraps each Redis cache twice ({@link SingleFlightCacheManager},
 * {@link RedisBackoffCacheManager}): Boot saw neither wrapper as a Redis cache and bound nothing, so
 * cache efficiency was invisible in Prometheus
 * (https://github.com/stefanf81/taskflow-enterprise/issues/228). This provider unwraps them and
 * hands the Redis cache to Boot's own binder. The counters need
 * {@code spring.cache.redis.enable-statistics=true} (set in the prod profile); without it they stay
 * at zero. Statistics describe this JVM's calls, not the shared Redis, so sum over replicas.
 * One cold load counts several misses ({@link SingleFlightCacheManager} looks the key up again under
 * its lock), so the hit ratio is a conservative figure.
 */
@Configuration(proxyBeanMethods = false)
class CacheMetricsConfig {

    @Bean
    CacheMeterBinderProvider<SingleFlightCacheManager.SingleFlightCache> wrappedRedisCacheMeterBinderProvider() {
        return new WrappedRedisCacheMeterBinderProvider();
    }

    /** Named class, not a lambda: Boot picks the provider for a cache by its generic type. */
    static final class WrappedRedisCacheMeterBinderProvider
            implements CacheMeterBinderProvider<SingleFlightCacheManager.SingleFlightCache> {

        private final RedisCacheMeterBinderProvider redis = new RedisCacheMeterBinderProvider();

        @Override
        public MeterBinder getMeterBinder(SingleFlightCacheManager.SingleFlightCache cache, Iterable<Tag> tags) {
            return redisCache(cache) instanceof RedisCache redisCache ? redis.getMeterBinder(redisCache, tags) : null;
        }

        /** The Redis cache beneath the decorators, or whatever else the chain ends in. */
        static Cache redisCache(Cache cache) {
            Cache current = cache;
            while (true) {
                if (current instanceof SingleFlightCacheManager.SingleFlightCache singleFlight) {
                    current = singleFlight.getDelegate();
                } else if (current instanceof RedisBackoffCacheManager.BackoffCache backoff) {
                    current = backoff.getDelegate();
                } else {
                    return current;
                }
            }
        }
    }
}
