package com.example.taskflow.appointment;

import com.example.taskflow.core.CacheConfig;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.SerializationException;

import java.time.Duration;

/** The appointment module's Redis caches: typed values (see {@link CacheConfig}), applied when the cache type is redis. */
@Configuration
class AppointmentCacheConfig {

    static final String BARBERS_CACHE = "barbers";
    static final String PUBLIC_BARBERS_CACHE = "publicBarbers";

    static RedisCacheConfiguration barbersCache() {
        return CacheConfig.listCache(Duration.ofMinutes(10), BarberResponse.class);
    }

    static RedisCacheConfiguration publicBarbersCache() {
        return CacheConfig.listCache(Duration.ofMinutes(10), PublicBarberResponse.class);
    }

    static RedisCacheConfiguration busySlotsCache() {
        return CacheConfig.listCache(Duration.ofMinutes(2), String.class);
    }

    static RedisCacheConfiguration statsCache() {
        return CacheConfig.cache(Duration.ofMinutes(5), new StatsValueSerializer());
    }

    @Bean
    RedisCacheManagerBuilderCustomizer appointmentCaches() {
        return builder -> builder
                .withCacheConfiguration(BARBERS_CACHE, barbersCache())
                .withCacheConfiguration(PUBLIC_BARBERS_CACHE, publicBarbersCache())
                .withCacheConfiguration(AppointmentStatsService.BUSY_SLOTS_CACHE, busySlotsCache())
                .withCacheConfiguration(AppointmentStatsService.STATS_CACHE, statsCache());
    }

    /**
     * {@code appointmentStats} holds an {@link AppointmentStats} per date and the {@code Long} row
     * count ({@link AppointmentStatsService#TOTAL_COUNT_KEY}). A JSON object is the former, anything
     * else the latter, so no type id is stored and only these two types can come out of Redis.
     */
    static final class StatsValueSerializer implements RedisSerializer<Object> {

        private final RedisSerializer<AppointmentStats> stats = CacheConfig.typedValueSerializer(AppointmentStats.class);
        private final RedisSerializer<Long> count = CacheConfig.typedValueSerializer(Long.class);

        @Override
        public byte[] serialize(Object value) {
            if (value instanceof AppointmentStats appointmentStats) {
                return stats.serialize(appointmentStats);
            }
            if (value instanceof Long total) {
                return count.serialize(total);
            }
            throw new SerializationException("Unexpected appointmentStats value type: "
                    + (value == null ? "null" : value.getClass().getName()));
        }

        @Override
        public Object deserialize(byte[] bytes) {
            if (bytes == null || bytes.length == 0) {
                return null;
            }
            return startsWithObject(bytes) ? stats.deserialize(bytes) : count.deserialize(bytes);
        }

        private static boolean startsWithObject(byte[] bytes) {
            for (byte b : bytes) {
                if (!Character.isWhitespace(b)) {
                    return b == '{';
                }
            }
            return false;
        }
    }
}
