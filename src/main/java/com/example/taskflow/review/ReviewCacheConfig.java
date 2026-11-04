package com.example.taskflow.review;

import com.example.taskflow.core.cache.CacheConfig;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;

import java.time.Duration;

/** The review module's Redis cache: typed values (see {@link CacheConfig}), applied when the cache type is redis. */
@Configuration
class ReviewCacheConfig {

    static final String BARBER_RATINGS_CACHE = "barberRatings";
    /** The one entry of {@link #BARBER_RATINGS_CACHE}: the ratings of every barber. */
    static final String ALL_RATINGS_KEY = "all";

    /**
     * Evicted after every committed change of a counted review ({@link BarberRatingsChangedEvent}).
     * The TTL bounds what a skipped eviction (Redis unavailable, ADR-018) or a load racing a commit
     * can leave behind.
     */
    static RedisCacheConfiguration barberRatingsCache() {
        return CacheConfig.listCache(Duration.ofMinutes(10), BarberRatingResponse.class);
    }

    @Bean
    RedisCacheManagerBuilderCustomizer reviewCaches() {
        return builder -> builder.withCacheConfiguration(BARBER_RATINGS_CACHE, barberRatingsCache());
    }
}
