package com.example.taskflow.appointment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.*;

/**
 * Verifies the eviction primitives. {@code evictIfPresent} (blocking DEL) and
 * {@code invalidate} (blocking scan+delete) must be used instead of
 * {@code evict}/{@code clear}, which are asynchronous with the production
 * Lettuce-backed Redis cache writer.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentStatsServiceTest {

    @Mock
    private CacheManager cacheManager;

    @Mock
    private Cache busySlotsCache;

    @Mock
    private Cache statsCache;

    private AppointmentStatsService service;

    @BeforeEach
    void setUp() {
        service = new AppointmentStatsService(cacheManager);
    }

    @Test
    void clearAvailabilityCache_shouldEvictConcreteAndSentinelWithImmediatePrimitive() {
        when(cacheManager.getCache(AppointmentStatsService.BUSY_SLOTS_CACHE)).thenReturn(busySlotsCache);

        service.clearAvailabilityCache("Alex the Barber", LocalDate.of(2026, 5, 16));

        verify(busySlotsCache).evictIfPresent("Alex the Barber-2026-05-16");
        verify(busySlotsCache).evictIfPresent(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-2026-05-16");
        verify(busySlotsCache, never()).evict(any());
    }

    @Test
    void clearAllBusySlotsCache_shouldInvalidateNotClear() {
        when(cacheManager.getCache(AppointmentStatsService.BUSY_SLOTS_CACHE)).thenReturn(busySlotsCache);

        service.clearAllBusySlotsCache();

        verify(busySlotsCache).invalidate();
        verify(busySlotsCache, never()).clear();
    }

    @Test
    void clearStatsCache_shouldUseImmediateEvict() {
        when(cacheManager.getCache(AppointmentStatsService.STATS_CACHE)).thenReturn(statsCache);

        service.clearStatsCache();

        verify(statsCache).evictIfPresent(LocalDate.now());
        verify(statsCache, never()).evict(any());
    }

    @Test
    void missingCache_shouldBeTolerated() {
        when(cacheManager.getCache(anyString())).thenReturn(null);

        assertDoesNotThrow(() -> service.clearAvailabilityCache("Alex", LocalDate.now()));
        assertDoesNotThrow(service::clearAllBusySlotsCache);
        assertDoesNotThrow(service::clearStatsCache);
    }
}
