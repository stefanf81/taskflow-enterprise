package com.example.taskflow.core.cache;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.cache.autoconfigure.CacheAutoConfiguration;
import org.springframework.boot.cache.autoconfigure.metrics.CacheMetricsAutoConfiguration;
import org.springframework.boot.data.redis.autoconfigure.DataRedisAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The Redis cache manager Boot's auto-configuration builds with {@link CacheConfig} (nothing here
 * connects to Redis): decorated, and clearing with {@code SCAN}. Moved out of
 * {@code core.redis.RedisConnectionConfigTest} with the cache classes.
 */
class CacheConfigContextTest {

    @Configuration(proxyBeanMethods = false)
    @EnableCaching
    static class Caching {
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(DataRedisAutoConfiguration.class, CacheAutoConfiguration.class))
            .withUserConfiguration(CacheConfig.class, Caching.class)
            .withPropertyValues("spring.data.redis.port=1", "spring.data.redis.connect-timeout=1s",
                    "spring.cache.type=redis");

    @Test
    void cacheClearUsesScanAndTheDecoratorsStillWrapTheManager() {
        runner.run(context -> {
            CacheManager cacheManager = context.getBean(CacheManager.class);
            assertThat(cacheManager).isInstanceOf(SingleFlightCacheManager.class);
            CacheManager backoff = ((SingleFlightCacheManager) cacheManager).getDelegate();
            assertThat(backoff).isInstanceOf(RedisBackoffCacheManager.class);
            RedisCacheManager redis = (RedisCacheManager) ((RedisBackoffCacheManager) backoff).getDelegate();

            Object writer = ReflectionTestUtils.invokeMethod(redis, "getCacheWriter");
            Object batchStrategy = ReflectionTestUtils.getField(writer, "batchStrategy");
            assertThat(batchStrategy.getClass().getSimpleName()).isEqualTo("Scan");
            assertThat(ReflectionTestUtils.getField(batchStrategy, "batchSize")).isEqualTo(1000);
        });
    }

    /**
     * https://github.com/stefanf81/taskflow-enterprise/issues/228: Boot binds cache metrics only for
     * caches it recognises, and both decorators hid the Redis cache, so nothing was bound.
     */
    @Test
    void redisCachesAreBoundToMicrometerThroughTheDecorators() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(DataRedisAutoConfiguration.class,
                        CacheAutoConfiguration.class, CacheMetricsAutoConfiguration.class))
                .withUserConfiguration(CacheConfig.class, CacheMetricsConfig.class, Caching.class, Registry.class)
                .withPropertyValues("spring.data.redis.port=1", "spring.data.redis.connect-timeout=1s",
                        "spring.cache.type=redis", "spring.cache.cache-names=services,barbers",
                        "spring.cache.redis.enable-statistics=true")
                .run(context -> {
                    MeterRegistry registry = context.getBean(MeterRegistry.class);
                    for (String cache : new String[] {"services", "barbers"}) {
                        assertThat(registry.find("cache.gets").tag("cache", cache).tag("result", "hit").functionCounter())
                                .as("hits of %s", cache).isNotNull();
                        assertThat(registry.find("cache.gets").tag("cache", cache).tag("result", "miss").functionCounter())
                                .as("misses of %s", cache).isNotNull();
                        assertThat(registry.find("cache.puts").tag("cache", cache).functionCounter())
                                .as("puts of %s", cache).isNotNull();
                        assertThat(registry.find("cache.removals").tag("cache", cache).functionCounter())
                                .as("removals of %s", cache).isNotNull();
                    }
                });
    }

    @Test
    void theProviderReachesTheRedisCacheBeneathBothDecorators() {
        runner.withPropertyValues("spring.cache.cache-names=services").run(context -> {
            org.springframework.cache.Cache cache = context.getBean(CacheManager.class).getCache("services");
            assertThat(cache).isInstanceOf(SingleFlightCacheManager.SingleFlightCache.class);
            assertThat(CacheMetricsConfig.WrappedRedisCacheMeterBinderProvider.redisCache(cache))
                    .isInstanceOf(org.springframework.data.redis.cache.RedisCache.class);
        });
    }

    @Configuration(proxyBeanMethods = false)
    static class Registry {
        @org.springframework.context.annotation.Bean
        MeterRegistry meterRegistry() {
            return new SimpleMeterRegistry();
        }
    }
}
