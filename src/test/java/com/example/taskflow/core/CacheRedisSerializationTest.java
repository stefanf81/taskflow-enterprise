package com.example.taskflow.core;

import com.example.taskflow.appointment.BarberResponse;
import com.example.taskflow.appointment.PublicBarberResponse;
import com.example.taskflow.catalog.ServiceItemResponse;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.serializer.RedisSerializer;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Round-trips the cached DTOs through {@link CacheConfig#cacheValueSerializer()} — the exact
 * serializer wired into every cache — so the explicit polymorphic-type allow-list is tested
 * where it lives instead of a duplicated copy that could drift.
 */
class CacheRedisSerializationTest {

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
