package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItemResponse;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.Callable;

/**
 * Dedicated service for appointment statistics and availability caching, kept apart from the
 * services that read and write appointments so the caching concerns stay isolated.
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
class AppointmentStatsService {

    static final String BUSY_SLOTS_CACHE = "busySlots";
    static final String STATS_CACHE = "appointmentStats";
    /** Key of the total row count in {@link #STATS_CACHE}, next to the per-date stats keys. */
    static final String TOTAL_COUNT_KEY = "total-count";
    /** Most dates whose availability is evicted key by key; a longer range invalidates the cache. */
    static final int MAX_DATES_EVICTED_BY_KEY = 7;

    private static final Logger log = LoggerFactory.getLogger(AppointmentStatsService.class);

    private final CacheManager cacheManager;
    private final Clock clock;
    private final CatalogService catalogService;
    private final AppointmentRepository appointmentRepository;
    private final BookingProperties bookingProperties;

    AppointmentStatsService(CacheManager cacheManager, Clock clock, CatalogService catalogService,
                            AppointmentRepository appointmentRepository, BookingProperties bookingProperties) {
        this.cacheManager = cacheManager;
        this.clock = clock;
        this.catalogService = catalogService;
        this.appointmentRepository = appointmentRepository;
        this.bookingProperties = bookingProperties;
    }

    public AppointmentStats getStatsCached() {
        LocalDate today = LocalDate.now(clock);
        return cachedOrDirect(today, () -> appointmentRepository.getAppointmentStats(today));
    }

    /**
     * Number of appointment rows (every status), for the unfiltered admin listing. Counting the
     * whole table on every dashboard request was nearly all of that request's database time; the
     * count changes only with a booking, which evicts it together with the stats.
     */
    public long getTotalCountCached() {
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
     * Available)" aggregate on every date of an inclusive range. The aggregate spans every
     * barber, so any single-barber availability change makes it stale. The length-aware lists
     * ({@code <barber>-<date>-<minutes>}, for services longer than one grid step) go with them.
     *
     * <p>Only dates inside the booking window can have entries: busy slots of any other date are
     * answered without the cache ({@code AppointmentBookingService#busyOutsideBookingWindow}), so
     * the range is clamped to today .. today + {@code max-advance-days} first. More than
     * {@link #MAX_DATES_EVICTED_BY_KEY} remaining dates (a long time off) clear the whole cache
     * with one scan instead: key by key, 90 days cost up to 450 sequential Redis round trips
     * before the admin's request could answer. The catalog's durations are read once per call.
     */
    public void clearAvailabilityCache(String barberName, LocalDate firstDate, LocalDate lastDate) {
        Cache cache = cacheManager.getCache(BUSY_SLOTS_CACHE);
        if (cache == null) {
            return;
        }
        LocalDate today = LocalDate.now(clock);
        LocalDate lastBookable = today.plusDays(bookingProperties.maxAdvanceDays());
        LocalDate first = firstDate.isBefore(today) ? today : firstDate;
        LocalDate last = lastDate.isAfter(lastBookable) ? lastBookable : lastDate;
        if (last.isBefore(first)) {
            return;
        }
        if (ChronoUnit.DAYS.between(first, last) + 1 > MAX_DATES_EVICTED_BY_KEY) {
            cache.invalidate();
            return;
        }
        List<Integer> longDurations = longServiceDurations();
        for (LocalDate date = first; !date.isAfter(last); date = date.plusDays(1)) {
            evictAvailability(cache, barberName + "-" + date, longDurations);
            evictAvailability(cache, AppointmentBookingService.NO_PREFERENCE_BARBER + "-" + date, longDurations);
        }
    }

    private static void evictAvailability(Cache cache, String key, List<Integer> longDurations) {
        cache.evictIfPresent(key);
        for (int minutes : longDurations) {
            cache.evictIfPresent(key + "-" + minutes);
        }
    }

    /**
     * Distinct durations of the bookable services that are longer than one grid step: the only
     * ones whose busy-slot lists are cached under a length-specific key. If the catalog cannot be
     * read, those entries simply expire with their 2-minute TTL.
     */
    private List<Integer> longServiceDurations() {
        try {
            return catalogService.getAllServices().stream()
                    .map(ServiceItemResponse::durationMinutes)
                    .filter(minutes -> minutes != null && minutes > BusySlotsService.DEFAULT_DURATION_MINUTES)
                    .distinct()
                    .toList();
        } catch (RuntimeException e) {
            log.warn("Could not list service durations for availability eviction: {}",
                    LogSanitizer.safeMessage(e));
            return List.of();
        }
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
