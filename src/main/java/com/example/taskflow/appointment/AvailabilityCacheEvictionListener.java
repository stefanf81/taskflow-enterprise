package com.example.taskflow.appointment;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDate;

/**
 * Invalidates availability caches only after the mutating transaction has
 * committed.
 *
 * <p>Running after commit removes two failure modes of the previous in-transaction
 * eviction: a reader repopulating {@code busySlots} from pre-commit state, and a
 * rolled-back mutation clearing committed cache entries. Eviction failures are
 * logged and swallowed so a Redis outage can never fail an already-committed
 * booking.
 *
 * <p>The residual read-load-write race (a loader that started before the commit
 * writing its stale value after this eviction) is bounded by the 2-minute
 * {@code busySlots} TTL and the database guards (in-transaction time-off recheck
 * and the partial unique slot index).
 */
@Component
public class AvailabilityCacheEvictionListener {

    private static final Logger logger = LoggerFactory.getLogger(AvailabilityCacheEvictionListener.class);

    /** Same safety cap as the previous in-service eviction loop. */
    private static final int MAX_EVICT_DAYS = 366;

    private final AppointmentStatsService statsService;

    public AvailabilityCacheEvictionListener(AppointmentStatsService statsService) {
        this.statsService = statsService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onAvailabilityChanged(AvailabilityChangedEvent event) {
        try {
            if (event.affectsAllBarbers()) {
                statsService.clearAllBusySlotsCache();
                statsService.clearStatsCache();
                return;
            }

            LocalDate date = event.startDate();
            if (date == null || event.endDate() == null) {
                return;
            }
            int count = 0;
            while (!date.isAfter(event.endDate()) && count < MAX_EVICT_DAYS) {
                statsService.clearAvailabilityCache(event.barberName(), date);
                date = date.plusDays(1);
                count++;
            }
            if (!date.isAfter(event.endDate())) {
                logger.warn(
                        "Availability cache eviction for barber {} capped at {} days (range exceeded the limit).",
                        LogSanitizer.mask(event.barberName()),
                        MAX_EVICT_DAYS);
            }
            statsService.clearStatsCache();
        } catch (RuntimeException ex) {
            logger.error(
                    "Availability cache eviction failed for barber {} [{}..{}]: {}",
                    LogSanitizer.mask(event.barberName()),
                    event.startDate(),
                    event.endDate(),
                    LogSanitizer.safeMessage(ex),
                    ex);
        }
    }
}
