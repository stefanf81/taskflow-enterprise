package com.example.taskflow.notification;

import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;

/**
 * Keeps the outbox table bounded: once a day, deletes delivered ({@code SENT}) rows that are older
 * than {@code app.notification.retention-days} (default 30). Rows still PENDING / PROCESSING /
 * FAILED are never touched, however old, so undelivered mail is not lost.
 *
 * <p>The age is measured from {@code sent_at}, the instant the row was enqueued.
 * Configure the schedule with {@code app.notification.retention-cron} (Spring cron, default 03:30
 * every day).
 */
@Component
class NotificationRetentionScheduler {

    private static final Logger logger = LoggerFactory.getLogger(NotificationRetentionScheduler.class);

    private final NotificationOutboxRepository outboxRepository;
    private final Clock clock;
    private final int retentionDays;
    private final boolean schedulersEnabled;

    @Autowired
    public NotificationRetentionScheduler(NotificationOutboxRepository outboxRepository,
                                          Clock clock,
                                          @Value("${app.notification.retention-days:30}") int retentionDays,
                                          @Value("${app.schedulers.enabled:true}") boolean schedulersEnabled) {
        this.outboxRepository = outboxRepository;
        this.clock = clock;
        this.retentionDays = retentionDays;
        this.schedulersEnabled = schedulersEnabled;
    }

    @Scheduled(cron = "${app.notification.retention-cron:0 30 3 * * *}")
    public void scheduledPurge() {
        if (schedulersEnabled) {
            purgeOldSent();
        }
    }

    /** @return number of rows deleted */
    @Transactional
    public int purgeOldSent() {
        LocalDateTime cutoff = LocalDateTime.now(clock).minusDays(retentionDays);
        int deleted = outboxRepository.deleteSentBefore(cutoff);
        if (deleted > 0) {
            logger.info("Outbox retention removed {} SENT notification(s) older than {} days", deleted, retentionDays);
        }
        return deleted;
    }
}
