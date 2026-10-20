package com.example.taskflow.catalog;

import com.example.taskflow.core.CacheConfig;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;

import java.time.Duration;

/** The catalog's Redis cache: typed values (see {@link CacheConfig}), applied when the cache type is redis. */
@Configuration
class CatalogCacheConfig {

    static final String SERVICES_CACHE = "services";

    /** The active services of the public catalog; evicted on every catalog change. */
    static RedisCacheConfiguration servicesCache() {
        return CacheConfig.listCache(Duration.ofMinutes(10), ServiceItemResponse.class);
    }

    @Bean
    RedisCacheManagerBuilderCustomizer catalogCaches() {
        return builder -> builder.withCacheConfiguration(SERVICES_CACHE, servicesCache());
    }
}
