package com.example.taskflow.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.List;

/**
 * Drains the transactional outbox: delivers every PENDING entry and re-attempts
 * FAILED entries that have not yet exhausted the retry budget.
 *
 * <p>Delivery itself is performed by {@link NotificationSender}, which records the
 * truthful outcome (SENT / FAILED + incremented retry counter) against the row.
 *
 * <p>This class is intentionally NOT {@code @Transactional} as a whole: each
 * {@link NotificationSender#process} call must run in its own transaction so that
 * a transient failure on one outbox entry does not roll back previously-successful
 * sends in the same batch.
 */
@Component
public class NotificationRelayScheduler {

    private static final Logger logger = LoggerFactory.getLogger(NotificationRelayScheduler.class);
    private static final int MAX_RETRIES = 5;

    private final NotificationOutboxRepository outboxRepository;
    private final NotificationSender sender;

    public NotificationRelayScheduler(NotificationOutboxRepository outboxRepository, NotificationSender sender) {
        this.outboxRepository = outboxRepository;
        this.sender = sender;
    }

    @Scheduled(fixedDelay = 30000)
    public void relay() {
        List<NotificationOutbox> due = new ArrayList<>();
        due.addAll(outboxRepository.findByStatus("PENDING"));
        due.addAll(outboxRepository.findByStatusAndRetryCountLessThan("FAILED", MAX_RETRIES));

        if (due.isEmpty()) {
            return;
        }

        logger.info("Notification relay processing {} outbox entr{}", due.size(), due.size() == 1 ? "y" : "ies");
        for (NotificationOutbox outbox : due) {
            try {
                sender.process(outbox);
            } catch (Exception e) {
                String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
                logger.error("Relay failed to process outbox id={}: {}", outbox.getId(), safeMsg);
            }
        }
    }
}
