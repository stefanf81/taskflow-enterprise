package com.example.taskflow.core;

import com.example.taskflow.appointment.BarberResponse;
import com.example.taskflow.appointment.PublicBarberResponse;
import com.example.taskflow.catalog.ServiceItemResponse;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.RedisSerializer;

import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Round-trips the cached DTOs through the typed serializers every feature cache uses
 * ({@link CacheConfig#listCache}) and through {@link CacheConfig#cacheValueSerializer()}, the generic
 * default of a cache without its own configuration, so the allow-list is tested where it lives.
 */
class CacheRedisSerializationTest {

    @SuppressWarnings("unchecked")
    private static <T> T read(RedisCacheConfiguration config, byte[] bytes) {
        return (T) config.getValueSerializationPair().read(ByteBuffer.wrap(bytes));
    }

    private static byte[] write(RedisCacheConfiguration config, Object value) {
        ByteBuffer buffer = config.getValueSerializationPair().write(value);
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);
        return bytes;
    }

    @Test
    void typedListCacheRoundTripsWithoutTypeIds() {
        RedisCacheConfiguration services = CacheConfig.listCache(Duration.ofMinutes(10), ServiceItemResponse.class);
        List<ServiceItemResponse> original = List.of(
                new ServiceItemResponse(1L, "Cut", new BigDecimal("25.00"), 30, "hair", "desc"));

        byte[] bytes = write(services, original);
        String json = new String(bytes, StandardCharsets.UTF_8);

        assertFalse(json.contains("@class") || json.contains("java."), json);
        List<ServiceItemResponse> back = read(services, bytes);
        assertEquals(original, back);
        assertEquals("25.00", back.get(0).price().toPlainString(), "scale kept");
        assertEquals(Duration.ofMinutes(10), services.getTtlFunction().getTimeToLive("k", original));
        assertFalse(services.getAllowCacheNullValues());
    }

    @Test
    void typedStringListRoundTrips() {
        RedisCacheConfiguration slots = CacheConfig.listCache(Duration.ofMinutes(2), String.class);
        assertEquals(List.of("09:00", "10:00"), read(slots, write(slots, List.of("09:00", "10:00"))));
        assertEquals(List.of(), read(slots, write(slots, List.of())));
    }

    /** Entries written by the former generic serializer are misses (reloaded and overwritten), not errors. */
    @Test
    void entriesInTheFormerGenericFormatReadAsMisses() {
        RedisSerializer<Object> former = CacheConfig.cacheValueSerializer();
        RedisCacheConfiguration services = CacheConfig.listCache(Duration.ofMinutes(10), ServiceItemResponse.class);
        RedisCacheConfiguration barbers = CacheConfig.listCache(Duration.ofMinutes(10), BarberResponse.class);
        RedisCacheConfiguration slots = CacheConfig.listCache(Duration.ofMinutes(2), String.class);

        assertNull(read(services, former.serialize(List.of(
                new ServiceItemResponse(1L, "Cut", BigDecimal.TEN, 30, "hair", "d")))));
        assertNull(read(barbers, former.serialize(new ArrayList<>(List.of(
                new BarberResponse(1L, "A", "a@example.com", "555"))))));
        assertNull(read(slots, former.serialize(List.of("09:00", "10:00"))));
        assertNull(read(slots, former.serialize(List.of())));
        assertNull(read(slots, "not json".getBytes(StandardCharsets.UTF_8)));
    }

    /** A type id in the stored JSON cannot make the typed reader instantiate another class. */
    @Test
    void storedTypeIdsCannotSelectTheClass() {
        RedisCacheConfiguration services = CacheConfig.listCache(Duration.ofMinutes(10), ServiceItemResponse.class);
        Object back = read(services, "[[\"java.util.HashMap\",{}]]".getBytes(StandardCharsets.UTF_8));
        assertNull(back);
    }

    @Test
    void barberResponseList_roundTrip() {
        RedisSerializer<Object> s = CacheConfig.cacheValueSerializer();
        List<BarberResponse> original = List.of(
                new BarberResponse(1L, "Barber A", "a@example.com", "555-1"),
                new BarberResponse(2L, "Barber B", "b@example.com", "555-2")
        );
        byte[] bytes = s.serialize(original);
        assertNotNull(bytes);
        Object deserialized = s.deserialize(bytes);
        assertNotNull(deserialized);
        @SuppressWarnings("unchecked")
        List<BarberResponse> list = (List<BarberResponse>) deserialized;
        assertEquals(2, list.size());
        assertEquals("Barber A", list.get(0).name());
    }

    @Test
    void publicBarberResponseList_roundTrip() {
        RedisSerializer<Object> s = CacheConfig.cacheValueSerializer();
        List<PublicBarberResponse> original = List.of(new PublicBarberResponse(1L, "Barber A"));
        byte[] bytes = s.serialize(original);
        assertNotNull(bytes);
        Object deserialized = s.deserialize(bytes);
        assertNotNull(deserialized);
        @SuppressWarnings("unchecked")
        List<PublicBarberResponse> list = (List<PublicBarberResponse>) deserialized;
        assertEquals(1, list.size());
        assertEquals("Barber A", list.get(0).name());
    }

    @Test
    void serviceItemResponseList_roundTrip() {
        RedisSerializer<Object> s = CacheConfig.cacheValueSerializer();
        List<ServiceItemResponse> original = List.of(
                new ServiceItemResponse(1L, "Cut", BigDecimal.valueOf(25.00), 30, "hair", "desc")
        );
        byte[] bytes = s.serialize(original);
        assertNotNull(bytes);
        Object deserialized = s.deserialize(bytes);
        assertNotNull(deserialized);
        @SuppressWarnings("unchecked")
        List<ServiceItemResponse> list = (List<ServiceItemResponse>) deserialized;
        assertEquals(1, list.size());
        assertEquals("Cut", list.get(0).name());
        assertEquals(0, BigDecimal.valueOf(25.00).compareTo(list.get(0).price()));
    }

    @Test
    void emptyList_roundTrip() {
        RedisSerializer<Object> s = CacheConfig.cacheValueSerializer();
        List<BarberResponse> original = List.of();
        byte[] bytes = s.serialize(original);
        assertNotNull(bytes);
        Object deserialized = s.deserialize(bytes);
        assertNotNull(deserialized);
    }
}
