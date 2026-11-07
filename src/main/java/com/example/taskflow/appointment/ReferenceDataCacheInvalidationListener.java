package com.example.taskflow.appointment;

import com.example.taskflow.catalog.CatalogChangedEvent;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
class ReferenceDataCacheInvalidationListener {
    private static final Logger log = LoggerFactory.getLogger(ReferenceDataCacheInvalidationListener.class);
    private final CacheManager caches;

    ReferenceDataCacheInvalidationListener(CacheManager caches) {
        this.caches = caches;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onRosterChanged(BarberRosterChangedEvent event) {
        invalidate("barbers", "publicBarbers", AppointmentCacheConfig.OPENING_HOURS_CACHE);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onCatalogChanged(CatalogChangedEvent event) {
        if (event.availabilityChanged()) {
            // Include durations temporarily absent from the active catalog. Otherwise an old key
            // can survive a booking change and become visible again when that duration returns.
            invalidate(AppointmentStatsService.BUSY_SLOTS_CACHE);
        }
    }

    private void invalidate(String... names) {
        for (String name : names) {
            try {
                Cache cache = caches.getCache(name);
                if (cache != null) {
                    cache.invalidate();
                }
            } catch (RuntimeException e) {
                log.warn("{} cache invalidation failed; entries expire with their TTL: {}",
                        name, LogSanitizer.safeMessage(e));
            }
        }
    }
}
