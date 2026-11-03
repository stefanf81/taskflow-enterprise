package com.example.taskflow.core.cache;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.cache.autoconfigure.CacheAutoConfiguration;
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
}
