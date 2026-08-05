package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Delivers a single claimed {@link NotificationOutbox} entry.
 *
 * <p>Processes by primary key so the relay can release its claim transaction
 * before dispatch: {@link #process(Long)} reloads the row inside its own
 * transaction and resolves the truthful outcome (SENT / FAILED + incremented
 * retry counter).
 *
 * <p>The SMTP gateway is simulated, so delivery is treated as successful. When a
 * real gateway is wired in, {@link #simulateSend(NotificationOutbox)} should
 * return the actual outcome and failed rows will be retried by
 * {@link NotificationRelayScheduler}.
 */
@Component
public class NotificationSender {

    private static final Logger logger = LoggerFactory.getLogger(NotificationSender.class);

    private final NotificationOutboxRepository outboxRepository;

    public NotificationSender(NotificationOutboxRepository outboxRepository) {
        this.outboxRepository = outboxRepository;
    }

    /**
     * Send a single outbox entry and persist the truthful outcome. Runs in its
     * own transaction (REQUIRES_NEW) so a failure resolving one row does not roll
     * back the whole relay batch. REQUIRES_NEW is explicit so that even if a
     * caller happens to be transactional, the send is committed (or rolled back)
     * in a dedicated transaction — matching the relay's "each entry in
     * isolation" design.
     *
     * @param outboxId the id of a row previously claimed as PROCESSING
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void process(Long outboxId) {
        NotificationOutbox outbox = outboxRepository.findById(outboxId).orElse(null);
        if (outbox == null) {
            logger.warn("Outbox id={} no longer exists; skipping.", outboxId);
            return;
        }
        boolean delivered = simulateSend(outbox);

        if (delivered) {
            outbox.setStatus("SENT");
            outbox.setClaimedAt(null);
            outbox.setClaimedBy(null);
        } else {
            outbox.setStatus("FAILED");
            outbox.setRetryCount(outbox.getRetryCount() + 1);
            outbox.setClaimedAt(null);
            outbox.setClaimedBy(null);
        }

        try {
            outboxRepository.save(outbox);
        } catch (Exception e) {
            // Do NOT swallow — rethrow so the REQUIRES_NEW transaction rolls
            // back and the relay's outer catch logs the failure. The row stays
            // in PROCESSING (set by claimBatch in a prior committed tx) and the
            // stale-claim reclaimer resets it to PENDING for retry after
            // CLAIM_STALE_MINUTES. Swallowing here would silently commit an
            // empty transaction and lose the failure signal.
            String safeMsg = LogSanitizer.safeMessage(e);
            logger.error("Failed to persist notification outcome for outbox id={}: {}", outbox.getId(), safeMsg);
            throw e;
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