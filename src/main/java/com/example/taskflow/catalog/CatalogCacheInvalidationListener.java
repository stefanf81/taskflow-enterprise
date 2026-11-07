package com.example.taskflow.catalog;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
class CatalogCacheInvalidationListener {
    private static final Logger log = LoggerFactory.getLogger(CatalogCacheInvalidationListener.class);
    private final CacheManager caches;

    CatalogCacheInvalidationListener(CacheManager caches) {
        this.caches = caches;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onCatalogChanged(CatalogChangedEvent event) {
        try {
            Cache cache = caches.getCache("services");
            if (cache != null) {
                // Lettuce's clear() can return before the keys are removed in Spring Data Redis 4.
                cache.invalidate();
            }
        } catch (RuntimeException e) {
            log.warn("Catalog cache invalidation failed; entries expire with their TTL: {}",
                    LogSanitizer.safeMessage(e));
        }
    }
}
