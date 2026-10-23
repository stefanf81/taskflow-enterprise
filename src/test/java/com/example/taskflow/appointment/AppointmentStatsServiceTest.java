package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItemResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.redis.RedisConnectionFailureException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.Callable;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
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
    private CatalogService catalogService;

    @Mock
    private Cache statsCache;

    @Mock
    private AppointmentRepository appointmentRepository;

    /** Late evening UTC = already the next day in Tokyo: "today" must follow the shop clock. */
    private static final java.time.Clock CLOCK = java.time.Clock.fixed(
            java.time.Instant.parse("2026-10-11T23:30:00Z"), java.time.ZoneId.of("Asia/Tokyo"));

    private AppointmentStatsService service;

    @BeforeEach
    void setUp() {
        service = new AppointmentStatsService(cacheManager, CLOCK, catalogService);
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
    void clearAvailabilityCache_shouldAlsoEvictLengthAwareListsOfLongServices() {
        when(cacheManager.getCache(AppointmentStatsService.BUSY_SLOTS_CACHE)).thenReturn(busySlotsCache);
        when(catalogService.getAllServices()).thenReturn(List.of(
                service("Cut", 45), service("Fade", 90), service("Package", 120), service("Fade 2", 90)));

        service.clearAvailabilityCache("Alex the Barber", LocalDate.of(2026, 5, 16));

        String sentinel = AppointmentServiceImpl.NO_PREFERENCE_BARBER;
        for (String barber : List.of("Alex the Barber", sentinel)) {
            verify(busySlotsCache).evictIfPresent(barber + "-2026-05-16");
            verify(busySlotsCache).evictIfPresent(barber + "-2026-05-16-90");
            verify(busySlotsCache).evictIfPresent(barber + "-2026-05-16-120");
        }
        // 45 minutes uses the start-minute list, and a duration shared by two services is evicted once.
        verify(busySlotsCache, never()).evictIfPresent("Alex the Barber-2026-05-16-45");
        verify(busySlotsCache, times(4)).evictIfPresent(contains("-2026-05-16-"));
    }

    @Test
    void clearAvailabilityCache_shouldStillEvictTheBaseKeysWhenTheCatalogCannotBeRead() {
        when(cacheManager.getCache(AppointmentStatsService.BUSY_SLOTS_CACHE)).thenReturn(busySlotsCache);
        when(catalogService.getAllServices()).thenThrow(new RedisConnectionFailureException("down"));

        assertDoesNotThrow(() -> service.clearAvailabilityCache("Alex the Barber", LocalDate.of(2026, 5, 16)));

        verify(busySlotsCache).evictIfPresent("Alex the Barber-2026-05-16");
        verify(busySlotsCache).evictIfPresent(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-2026-05-16");
    }

    private static ServiceItemResponse service(String name, int minutes) {
        return new ServiceItemResponse(1L, name, BigDecimal.TEN, minutes, "hair", null);
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

        verify(statsCache).evictIfPresent(LocalDate.of(2026, 10, 12));
        verify(statsCache).evictIfPresent(AppointmentStatsService.TOTAL_COUNT_KEY);
        verify(statsCache, never()).evict(any());
    }

    @Test
    void totalCount_isReadThroughTheStatsCache() {
        when(cacheManager.getCache(AppointmentStatsService.STATS_CACHE)).thenReturn(statsCache);
        when(statsCache.get(eq(AppointmentStatsService.TOTAL_COUNT_KEY), any(Callable.class))).thenReturn(42L);

        assertEquals(42L, service.getTotalCountCached(appointmentRepository));
        verify(appointmentRepository, never()).count();
    }

    @Test
    void failingCacheStore_isBypassedInsteadOfFailingTheDashboard() {
        when(cacheManager.getCache(AppointmentStatsService.STATS_CACHE)).thenReturn(statsCache);
        when(statsCache.get(any(), any(Callable.class)))
                .thenThrow(new RedisConnectionFailureException("Redis command timed out"));
        AppointmentStats stats = new AppointmentStats(3L, 1L, 2L, 0L, 0L, 0, 50.0);
        when(appointmentRepository.getAppointmentStats(LocalDate.of(2026, 10, 12))).thenReturn(stats);
        when(appointmentRepository.count()).thenReturn(7L);

        assertSame(stats, service.getStatsCached(appointmentRepository));
        assertEquals(7L, service.getTotalCountCached(appointmentRepository));
    }

    @Test
    void failingQuery_stillPropagates() {
        when(cacheManager.getCache(AppointmentStatsService.STATS_CACHE)).thenReturn(statsCache);
        Cache.ValueRetrievalException failure =
                new Cache.ValueRetrievalException(LocalDate.of(2026, 10, 12), () -> null, new IllegalStateException("db"));
        when(statsCache.get(any(), any(Callable.class))).thenThrow(failure);

        assertSame(failure, assertThrows(Cache.ValueRetrievalException.class,
                () -> service.getStatsCached(appointmentRepository)));
        verify(appointmentRepository, never()).getAppointmentStats(any());
    }

    @Test
    void missingCache_shouldBeTolerated() {
        when(cacheManager.getCache(anyString())).thenReturn(null);

        assertDoesNotThrow(() -> service.clearAvailabilityCache("Alex", LocalDate.now()));
        assertDoesNotThrow(service::clearAllBusySlotsCache);
        assertDoesNotThrow(service::clearStatsCache);
    }
}
