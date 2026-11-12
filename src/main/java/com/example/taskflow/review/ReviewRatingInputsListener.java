package com.example.taskflow.review;

import com.example.taskflow.appointment.AppointmentCancelledEvent;
import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentRescheduledEvent;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.review.internal.ReviewRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Keeps the per-review rating inputs (V38) in step with the reviewed appointment and the cached
 * ratings in step with both.
 *
 * <p>A review counts while its appointment is APPROVED. The status and cancellation events are
 * handled inside the transaction that publishes them, so the flag commits or rolls back together
 * with the status change (like the notification outbox row). Only a change of a reviewed
 * appointment evicts the cached ratings, after the commit: approving an upcoming booking, which
 * cannot have a review yet, leaves them cached. A failed eviction is logged and skipped (ADR-018);
 * the entry then expires with its TTL.
 */
@Component
class ReviewRatingInputsListener {

    private static final Logger logger = LoggerFactory.getLogger(ReviewRatingInputsListener.class);

    private final ReviewRepository reviewRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final CacheManager cacheManager;

    ReviewRatingInputsListener(ReviewRepository reviewRepository, ApplicationEventPublisher eventPublisher,
                               CacheManager cacheManager) {
        this.reviewRepository = reviewRepository;
        this.eventPublisher = eventPublisher;
        this.cacheManager = cacheManager;
    }

    @EventListener
    public void onStatusChanged(AppointmentStatusChangedEvent event) {
        sync(event.getAppointment());
    }

    @EventListener
    public void onCancelled(AppointmentCancelledEvent event) {
        sync(event.appointment());
    }

    @EventListener
    public void onRescheduled(AppointmentRescheduledEvent event) {
        sync(event.appointment());
    }

    private void sync(AppointmentDetails appointment) {
        if (appointment == null || appointment.id() == null) {
            return;
        }
        boolean counted = appointment.status() == AppointmentStatus.APPROVED;
        if (reviewRepository.updateCounted(appointment.id(), counted) > 0) {
            eventPublisher.publishEvent(new BarberRatingsChangedEvent());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onRatingsChanged(BarberRatingsChangedEvent event) {
        try {
            Cache cache = cacheManager.getCache(ReviewCacheConfig.BARBER_RATINGS_CACHE);
            if (cache != null) {
                // evictIfPresent is the blocking DEL; evict may be deferred (see AppointmentStatsService).
                cache.evictIfPresent(ReviewCacheConfig.ALL_RATINGS_KEY);
            }
        } catch (RuntimeException e) {
            logger.warn("Barber ratings cache eviction failed, the entry expires with its TTL: {}",
                    LogSanitizer.safeMessage(e));
        }
    }
}
