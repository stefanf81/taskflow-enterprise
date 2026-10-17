package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.util.concurrent.Callable;

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
    /** Key of the total row count in {@link #STATS_CACHE}, next to the per-date stats keys. */
    static final String TOTAL_COUNT_KEY = "total-count";

    private static final Logger log = LoggerFactory.getLogger(AppointmentStatsService.class);

    private final CacheManager cacheManager;
    private final Clock clock;

    public AppointmentStatsService(CacheManager cacheManager, Clock clock) {
        this.cacheManager = cacheManager;
        this.clock = clock;
    }

    public AppointmentStats getStatsCached(AppointmentRepository appointmentRepository) {
        LocalDate today = LocalDate.now(clock);
        return cachedOrDirect(today, () -> appointmentRepository.getAppointmentStats(today));
    }

    /**
     * Number of appointment rows (every status), for the unfiltered admin listing. Counting the
     * whole table on every dashboard request was nearly all of that request's database time; the
     * count changes only with a booking, which evicts it together with the stats.
     */
    public long getTotalCountCached(AppointmentRepository appointmentRepository) {
        return cachedOrDirect(TOTAL_COUNT_KEY, appointmentRepository::count);
    }

    public void clearStatsCache() {
        Cache cache = cacheManager.getCache(STATS_CACHE);
        if (cache != null) {
            cache.evictIfPresent(LocalDate.now(clock));
            cache.evictIfPresent(TOTAL_COUNT_KEY);
        }
    }

    /**
     * Reads through the stats cache. These are direct cache calls, which the {@code @Cacheable} error
     * handler does not cover: when the store itself fails (Redis down or hung) the value is computed
     * without the cache instead of failing the admin dashboard. A failing query still propagates.
     */
    private <T> T cachedOrDirect(Object key, Callable<T> loader) {
        Cache cache = cacheManager.getCache(STATS_CACHE);
        if (cache != null) {
            try {
                return cache.get(key, loader);
            } catch (Cache.ValueRetrievalException e) {
                throw e;
            } catch (RuntimeException e) {
                log.warn("Stats cache unavailable, computing without it: {}", LogSanitizer.safeMessage(e));
            }
        }
        try {
            return loader.call();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(e);
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
