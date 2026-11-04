package com.example.taskflow.review;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.cache.RedisCacheWriter;

import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;

class ReviewCacheConfigTest {

    @Test
    void registersTheTypedBarberRatingsCache() {
        RedisCacheManager.RedisCacheManagerBuilder builder = RedisCacheManager.builder(mock(RedisCacheWriter.class));
        new ReviewCacheConfig().reviewCaches().customize(builder);

        assertEquals(Set.of("barberRatings"), builder.getConfiguredCaches());
        RedisCacheConfiguration ratings = builder.getCacheConfigurationFor("barberRatings").orElseThrow();
        assertEquals(Duration.ofMinutes(10), ratings.getTtlFunction().getTimeToLive("key", "value"));
        assertFalse(ratings.getAllowCacheNullValues());

        List<BarberRatingResponse> value = List.of(new BarberRatingResponse("Alex", 4.5, 2L));
        ByteBuffer stored = ratings.getValueSerializationPair().write(value);
        assertEquals(value, ratings.getValueSerializationPair().read(stored));
    }
}
