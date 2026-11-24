package com.example.taskflow.catalog;

import com.example.taskflow.core.cache.CacheConfig;
import java.time.Duration;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;

/** The catalog's Redis cache: typed values (see {@link CacheConfig}), applied when the cache type is redis. */
@Configuration
class CatalogCacheConfig {

    static final String SERVICES_CACHE = "services";
    static final String PRODUCTS_CACHE = "products";
    static final String ANNOUNCEMENT_CACHE = "announcement";

    /** The active services of the public catalog; evicted on every catalog change. */
    static RedisCacheConfiguration servicesCache() {
        return CacheConfig.listCache(Duration.ofMinutes(10), ServiceItemResponse.class);
    }

    /** The retail products list (display only); evicted on every product write. */
    static RedisCacheConfiguration productsCache() {
        return CacheConfig.listCache(Duration.ofMinutes(10), RetailProductResponse.class);
    }

    /** The promo strip (one entry); evicted on every announcement write. */
    static RedisCacheConfiguration announcementCache() {
        return CacheConfig.cache(Duration.ofMinutes(10), CacheConfig.typedValueSerializer(AnnouncementResponse.class));
    }

    @Bean
    RedisCacheManagerBuilderCustomizer catalogCaches() {
        return builder -> builder.withCacheConfiguration(SERVICES_CACHE, servicesCache())
                .withCacheConfiguration(PRODUCTS_CACHE, productsCache())
                .withCacheConfiguration(ANNOUNCEMENT_CACHE, announcementCache());
    }
}
