package com.example.taskflow.notification;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Delivers a queued {@link NotificationOutbox} entry.
 *
 * <p>The SMTP gateway is simulated, so delivery is treated as successful. When a
 * real gateway is wired in, {@link #simulateSend(NotificationOutbox)} should return
 * the actual outcome and failed rows will be retried by {@link NotificationRelayScheduler}.
 */
@Component
public class NotificationSender {

    private static final Logger logger = LoggerFactory.getLogger(NotificationSender.class);

    private final NotificationOutboxRepository outboxRepository;

    public NotificationSender(NotificationOutboxRepository outboxRepository) {
        this.outboxRepository = outboxRepository;
    }

    /**
     * Send a single outbox entry and persist the truthful outcome. Runs in its own
     * transaction so a failure resolving one row does not roll back the whole relay batch.
     */
    @Transactional
    public void process(NotificationOutbox outbox) {
        boolean delivered = simulateSend(outbox);

        if (delivered) {
            outbox.setStatus("SENT");
        } else {
            outbox.setStatus("FAILED");
            outbox.setRetryCount(outbox.getRetryCount() + 1);
        }

        try {
            outboxRepository.save(outbox);
        } catch (Exception e) {
            String safeMsg = LogSanitizer.safeMessage(e);
            logger.error("Failed to persist notification outcome for outbox id={}: {}", outbox.getId(), safeMsg);
        }
    }

    /**
     * Simulated SMTP dispatch. Succeeds by default, but supports simulated failure
     * when the recipient email starts with "fail" or "invalid" to exercise retry paths.
     */
    boolean simulateSend(NotificationOutbox outbox) {
        logger.info("=========================================================================");
        logger.info("EMAIL DISPATCHER (SIMULATED SMTP GATEWAY - RELAY)");
        logger.info("=========================================================================");
        logger.info("To: {}", maskEmail(outbox.getRecipient()));
        logger.info("{}", outbox.getMessage());
        logger.info("=========================================================================");

        if (outbox != null && outbox.getRecipient() != null) {
            String recipient = outbox.getRecipient().toLowerCase().trim();
            if (recipient.startsWith("fail") || recipient.startsWith("invalid")) {
                logger.warn("Simulated SMTP dispatch failure for recipient: {}", maskEmail(outbox.getRecipient()));
                return false;
            }
        }
        return true;
    }

    private String maskEmail(String email) {
        if (email == null || email.isEmpty()) {
            return "***";
        }
        String sanitized = email.replaceAll("[\\r\\n]", "");
        int atIndex = sanitized.lastIndexOf('@');
        if (atIndex <= 0) {
            return "***";
        }
        String localPart = sanitized.substring(0, atIndex);
        String domain = sanitized.substring(atIndex);

        if (localPart.length() <= 2) {
            return "**" + domain;
        }

        return localPart.charAt(0) + "*" + localPart.charAt(localPart.length() - 1) + domain;
    }
}
