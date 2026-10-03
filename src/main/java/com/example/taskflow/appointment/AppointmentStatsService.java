package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;

import java.time.LocalDate;

/**
 * Dedicated service for appointment statistics and availability caching.
 * Extracted from {@link AppointmentServiceImpl} to reduce its dependency count
 * and keep caching concerns isolated.
 *
 * <p><b>Eviction semantics:</b> cache eviction must be applied immediately and
 * not deferred. The production Redis cache uses Boot's default non-locking
 * {@code RedisCacheWriter}, whose {@code evict}/{@code clear} operations are
 * asynchronous with a reactive-capable connection factory (Lettuce). This class
 * therefore uses {@link Cache#evictIfPresent(Object)} (a blocking {@code DEL})
 * and {@link Cache#invalidate()} (a blocking scan+delete) rather than
 * {@code evict}/{@code clear} (unawaited {@code UNLINK}).
 */
@Service
public class AppointmentStatsService {

    static final String BUSY_SLOTS_CACHE = "busySlots";
    static final String STATS_CACHE = "appointmentStats";

    private final CacheManager cacheManager;

    public AppointmentStatsService(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    public AppointmentStats getStatsCached(AppointmentRepository appointmentRepository) {
        Cache cache = cacheManager.getCache(STATS_CACHE);
        if (cache != null) {
            return cache.get(LocalDate.now(), () -> appointmentRepository.getAppointmentStats(LocalDate.now()));
        }
        return appointmentRepository.getAppointmentStats(LocalDate.now());
    }

    public void clearStatsCache() {
        Cache cache = cacheManager.getCache(STATS_CACHE);
        if (cache != null) {
            cache.evictIfPresent(LocalDate.now());
        }
    }

    /**
     * Evicts availability for one concrete barber and the "No Preference (First
     * Available)" aggregate on the same date. The aggregate spans every barber,
     * so any single-barber availability change makes it stale.
     */
    public void clearAvailabilityCache(String barberName, LocalDate bookingDate) {
        Cache cache = cacheManager.getCache(BUSY_SLOTS_CACHE);
        if (cache == null) {
            return;
        }
        cache.evictIfPresent(barberName + "-" + bookingDate);
        cache.evictIfPresent(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-" + bookingDate);
    }

    /**
     * Invalidates the entire availability cache. Used when the roster itself
     * changes, because the aggregate availability of every date is affected and
     * enumerating dates is not possible.
     */
    public void clearAllBusySlotsCache() {
        Cache cache = cacheManager.getCache(BUSY_SLOTS_CACHE);
        if (cache != null) {
            cache.invalidate();
        }
    }
}
