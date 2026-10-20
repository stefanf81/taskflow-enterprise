package com.example.taskflow.appointment;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.cache.RedisCacheWriter;
import org.springframework.data.redis.serializer.SerializationException;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

class AppointmentCacheConfigTest {

    private final AppointmentCacheConfig.StatsValueSerializer stats = new AppointmentCacheConfig.StatsValueSerializer();

    private static byte[] utf8(String json) {
        return json.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void statsCacheHoldsTheStatsRecordAndTheTotalCountWithoutTypeIds() {
        AppointmentStats value = new AppointmentStats(10, 4, 5, 1, 0, 0, 125.5);

        byte[] statsJson = stats.serialize(value);
        byte[] countJson = stats.serialize(682L);

        assertFalse(new String(statsJson, StandardCharsets.UTF_8).contains("@class"));
        assertEquals("682", new String(countJson, StandardCharsets.UTF_8));
        assertEquals(value, stats.deserialize(statsJson));
        assertEquals(682L, stats.deserialize(countJson));
        assertThrows(SerializationException.class, () -> stats.serialize("not a stats value"));
    }

    /** Exact values the former generic Jackson 2 serializer stored (captured from it). */
    @Test
    void formerGenericEntriesAreReadOrMissedNeverMisread() {
        assertEquals(new AppointmentStats(10, 4, 5, 1, 0, 50, 125.5), stats.deserialize(utf8(
                "{\"@class\":\"com.example.taskflow.appointment.AppointmentStats\",\"total\":10,\"pending\":4,"
                        + "\"approved\":5,\"denied\":1,\"overdue\":0,\"progress\":50,\"approvedRevenue\":125.5}")));
        assertNull(stats.deserialize(utf8("[\"java.lang.Long\",682]")));
        assertNull(stats.deserialize(utf8("{\"@class\":\"java.net.URL\",\"total\":\"x\"}")));

        RedisCacheConfiguration busySlots = AppointmentCacheConfig.busySlotsCache();
        assertNull(busySlots.getValueSerializationPair().read(
                ByteBuffer.wrap(utf8("[\"java.util.ImmutableCollections$List12\",[\"09:00\",\"10:00\"]]"))));
        assertNull(busySlots.getValueSerializationPair().read(
                ByteBuffer.wrap(utf8("[\"java.util.ImmutableCollections$ListN\",[]]"))));
        assertEquals(List.of("09:00"), busySlots.getValueSerializationPair().read(ByteBuffer.wrap(utf8("[\"09:00\"]"))));
    }

    @Test
    void registersEveryAppointmentCacheWithItsTtlAndNoNullValues() {
        RedisCacheManager.RedisCacheManagerBuilder builder =
                RedisCacheManager.builder(mock(RedisCacheWriter.class));
        new AppointmentCacheConfig().appointmentCaches().customize(builder);

        Map<String, Duration> expected = Map.of(
                "barbers", Duration.ofMinutes(10),
                "publicBarbers", Duration.ofMinutes(10),
                "busySlots", Duration.ofMinutes(2),
                "appointmentStats", Duration.ofMinutes(5));
        assertEquals(expected.keySet(), builder.getConfiguredCaches());
        expected.forEach((name, ttl) -> {
            RedisCacheConfiguration config = builder.getCacheConfigurationFor(name).orElseThrow();
            assertEquals(ttl, config.getTtlFunction().getTimeToLive("key", "value"), name);
            assertFalse(config.getAllowCacheNullValues(), name);
        });
    }
}
