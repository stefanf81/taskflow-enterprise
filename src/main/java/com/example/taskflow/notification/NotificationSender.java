package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/**
 * Delivers a single claimed {@link NotificationOutbox} entry.
 *
 * <p>Processes by primary key so the relay can release its claim transaction
 * before dispatch: {@link #process(Claim)} reloads the row inside its own
 * transaction, verifies that the row is still PROCESSING and still owned by the
 * caller's claim, dispatches, and records the truthful outcome (SENT / FAILED +
 * incremented retry counter + backoff) with a <em>conditional</em> UPDATE.
 *
 * <p><b>Claim ownership.</b> A claim is identified by {@code (claimedBy, claimedAt)}. If a send takes
 * longer than the stale-claim window the relay reclaims the row and another worker may claim it
 * again; the slow sender's late outcome write then matches 0 rows and is discarded, so a stale
 * SENT/FAILED can never overwrite a newer claim (and vice versa). Delivery is therefore
 * at-least-once: the slow send may already have gone out, but the row's state stays consistent.
 *
 * <p>The SMTP gateway is simulated, so delivery is treated as successful. When a
 * real gateway is wired in, {@link #simulateSend(NotificationOutbox)} should
 * return the actual outcome and failed rows will be retried by
 * {@link NotificationRelayScheduler}.
 */
@Component
public class NotificationSender {

    private static final Logger logger = LoggerFactory.getLogger(NotificationSender.class);

    /** Identifies one claim of an outbox row: who claimed it and at which (millisecond) instant. */
    public record Claim(Long id, String claimedBy, LocalDateTime claimedAt) {
    }

    private final NotificationOutboxRepository outboxRepository;
    private final boolean simulateFailures;
    private final Clock clock;

    /**
     * @param simulateFailures test/demo switch ({@code app.notification.simulate-failures},
     *        default off): treat recipients starting with "fail" or "invalid" as undeliverable
     *        so retry paths can be exercised. It must stay off in production — otherwise a
     *        genuine customer whose address starts with "invalid" would never be notified.
     */
    @Autowired
    public NotificationSender(NotificationOutboxRepository outboxRepository,
                              @Value("${app.notification.simulate-failures:false}") boolean simulateFailures,
                              Clock clock) {
        this.outboxRepository = outboxRepository;
        this.simulateFailures = simulateFailures;
        this.clock = clock;
    }

    NotificationSender(NotificationOutboxRepository outboxRepository, boolean simulateFailures) {
        this(outboxRepository, simulateFailures, Clock.systemDefaultZone());
    }

    NotificationSender(NotificationOutboxRepository outboxRepository) {
        this(outboxRepository, false);
    }

    /**
     * Convenience for callers that hold only an id: adopts whatever claim the row currently carries.
     * Prefer {@link #process(Claim)}, which fails safe if the row was reclaimed in the meantime.
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
        deliver(outbox, new Claim(outboxId, outbox.getClaimedBy(), outbox.getClaimedAt()));
    }

    /**
     * Send a single outbox entry and persist the truthful outcome. Runs in its
     * own transaction (REQUIRES_NEW) so a failure resolving one row does not roll
     * back the whole relay batch.
     *
     * <p>Nothing is sent, and nothing is written, unless the row is still PROCESSING and still
     * owned by {@code claim}.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void process(Claim claim) {
        NotificationOutbox outbox = outboxRepository.findById(claim.id()).orElse(null);
        if (outbox == null) {
            logger.warn("Outbox id={} no longer exists; skipping.", claim.id());
            return;
        }
        deliver(outbox, claim);
    }

    private void deliver(NotificationOutbox outbox, Claim claim) {
        if (!"PROCESSING".equals(outbox.getStatus())
                || claim.claimedBy() == null
                || !claim.claimedBy().equals(outbox.getClaimedBy())
                || !claim.claimedAt().equals(outbox.getClaimedAt())) {
            logger.warn("Outbox id={} is no longer claimed by this worker (status={}); not sending.",
                    claim.id(), outbox.getStatus());
            return;
        }

        boolean delivered;
        try {
            delivered = simulateSend(outbox);
        } catch (RuntimeException e) {
            logger.error("Dispatch of outbox id={} threw: {}", claim.id(), LogSanitizer.safeMessage(e));
            delivered = false;
        }

        int updated;
        try {
            if (delivered) {
                updated = outboxRepository.markSentIfClaimed(claim.id(), claim.claimedBy(), claim.claimedAt());
            } else {
                int retries = Math.min(outbox.getRetryCount() + 1, OutboxBackoff.MAX_ATTEMPTS);
                LocalDateTime next = LocalDateTime.now(clock)
                        .plus(OutboxBackoff.delayAfter(retries))
                        .truncatedTo(ChronoUnit.MILLIS);
                updated = outboxRepository.markFailedIfClaimed(
                        claim.id(), claim.claimedBy(), claim.claimedAt(), retries, next);
            }
        } catch (RuntimeException e) {
            // Do NOT swallow — rethrow so the REQUIRES_NEW transaction rolls back and the relay's
            // outer catch logs the failure. The row stays PROCESSING (set by claimBatch in a prior
            // committed tx) and the stale-claim reclaimer retries it (counting the attempt) after
            // CLAIM_STALE_MINUTES.
            logger.error("Failed to persist notification outcome for outbox id={}: {}",
                    claim.id(), LogSanitizer.safeMessage(e));
            throw e;
        }

        if (updated == 0) {
            logger.warn("Outbox id={} was reclaimed while being sent; outcome ({}) discarded.",
                    claim.id(), delivered ? "SENT" : "FAILED");
        }
    }

    /**
     * Simulated SMTP dispatch. Succeeds by default; with
     * {@code app.notification.simulate-failures=true} it fails for recipients whose
     * address starts with "fail" or "invalid" to exercise retry paths.
     *
     * <p>Only the outbox id, channel and a masked recipient are logged. The message
     * body carries the customer's name, barber and appointment time, so it stays out
     * of the logs (which are shipped and retained separately from the database).
     */
    boolean simulateSend(NotificationOutbox outbox) {
        logger.info("Dispatching notification id={} via simulated gateway to {}",
                outbox.getId(), maskEmail(outbox.getRecipient()));

        if (simulateFailures && outbox.getRecipient() != null) {
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
        String sanitized = email.replace("\n", "").replace("\r", "");
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
