package com.example.taskflow.core;

import com.example.taskflow.appointment.BarberResponse;
import com.example.taskflow.appointment.PublicBarberResponse;
import com.example.taskflow.catalog.ServiceItemResponse;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator;
import com.fasterxml.jackson.databind.jsontype.PolymorphicTypeValidator;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class CacheRedisSerializationTest {

    private GenericJackson2JsonRedisSerializer serializer() {
        PolymorphicTypeValidator v = BasicPolymorphicTypeValidator.builder()
                .allowIfSubType("com.example.taskflow.appointment.AppointmentStats")
                .allowIfSubType("com.example.taskflow.appointment.BarberResponse")
                .allowIfSubType("com.example.taskflow.appointment.PublicBarberResponse")
                .allowIfSubType("com.example.taskflow.catalog.ServiceItemResponse")
                .allowIfSubType("java.util.ArrayList")
                .allowIfSubType("java.util.ImmutableCollections$ListN")
                .allowIfSubType("java.util.ImmutableCollections$List12")
                .allowIfSubType("java.util.Collections$EmptyList")
                .allowIfSubType("java.util.Collections$SingletonList")
                .allowIfSubType("java.util.Arrays$ArrayList")
                .allowIfSubType("java.lang.String")
                .allowIfSubType("java.lang.Long")
                .allowIfSubType("java.lang.Double")
                .allowIfSubType("java.lang.Integer")
                .allowIfSubType("java.math.BigDecimal")
                .build();
        ObjectMapper mapper = new ObjectMapper();
        mapper.activateDefaultTyping(v, ObjectMapper.DefaultTyping.EVERYTHING, JsonTypeInfo.As.PROPERTY);
        return new GenericJackson2JsonRedisSerializer(mapper);
    }

    @Test
    void barberResponseList_roundTrip() {
        GenericJackson2JsonRedisSerializer s = serializer();
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
        GenericJackson2JsonRedisSerializer s = serializer();
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
        GenericJackson2JsonRedisSerializer s = serializer();
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
        GenericJackson2JsonRedisSerializer s = serializer();
        List<BarberResponse> original = List.of();
        byte[] bytes = s.serialize(original);
        assertNotNull(bytes);
        Object deserialized = s.deserialize(bytes);
        assertNotNull(deserialized);
    }
}
