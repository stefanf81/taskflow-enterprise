package com.example.taskflow.notification;

import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/**
 * Validates and snapshots a claim in a short transaction, sends without a transaction, then
 * conditionally records the outcome in another short transaction. A late outcome cannot overwrite
 * a newer claim. SMTP acceptance followed by a crash/DB failure can cause a duplicate: at-least-once.
 */
@Component
class NotificationSender {

    private static final Logger logger = LoggerFactory.getLogger(NotificationSender.class);

    public record Claim(Long id, String claimedBy, LocalDateTime claimedAt) { }

    private record Delivery(Claim claim, int retryCount, NotificationGateway.Message message) { }

    private final NotificationOutboxRepository outboxRepository;
    private final NotificationGateway gateway;
    private final Clock clock;
    private final TransactionTemplate readTransaction;
    private final TransactionTemplate outcomeTransaction;

    NotificationSender(NotificationOutboxRepository outboxRepository, NotificationGateway gateway,
                       Clock clock, PlatformTransactionManager transactions) {
        this.outboxRepository = outboxRepository;
        this.gateway = gateway;
        this.clock = clock;
        readTransaction = new TransactionTemplate(transactions);
        readTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        readTransaction.setReadOnly(true);
        outcomeTransaction = new TransactionTemplate(transactions);
        outcomeTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** Prefer a captured claim token; this convenience overload adopts the row's current claim. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void process(Long outboxId) {
        deliver(readTransaction.execute(status -> snapshot(outboxId, null)));
    }

    /** NOT_SUPPORTED also suspends an accidental caller transaction during network I/O. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void process(Claim claim) {
        deliver(readTransaction.execute(status -> snapshot(claim.id(), claim)));
    }

    private @Nullable Delivery snapshot(Long id, @Nullable Claim expected) {
        NotificationOutbox row = outboxRepository.findById(id).orElse(null);
        if (row == null) {
            logger.warn("Outbox id={} no longer exists; skipping.", id);
            return null;
        }
        Claim claim = expected != null ? expected : new Claim(id, row.getClaimedBy(), row.getClaimedAt());
        if (!"PROCESSING".equals(row.getStatus()) || claim.claimedBy() == null || claim.claimedAt() == null
                || !claim.claimedBy().equals(row.getClaimedBy()) || !claim.claimedAt().equals(row.getClaimedAt())) {
            logger.warn("Outbox id={} is no longer owned by this claim; skipping.", id);
            return null;
        }
        return new Delivery(claim, row.getRetryCount(),
                new NotificationGateway.Message(id, row.getRecipient(), row.getType(), row.getMessage()));
    }

    private void deliver(@Nullable Delivery delivery) {
        if (delivery == null) {
            return;
        }
        boolean delivered;
        try {
            gateway.send(delivery.message());
            delivered = true;
        } catch (RuntimeException e) {
            // Mail exceptions can contain recipients, credentials or message bodies. Never log their text/cause.
            logger.warn("Dispatch failed for outbox id={} ({})", delivery.claim().id(), e.getClass().getSimpleName());
            delivered = false;
        }
        boolean success = delivered;
        // A DB failure propagates/rolls back; PROCESSING survives until stale-claim recovery counts the attempt.
        outcomeTransaction.executeWithoutResult(status -> recordOutcome(delivery, success));
    }

    private void recordOutcome(Delivery delivery, boolean delivered) {
        Claim claim = delivery.claim();
        int updated;
        if (delivered) {
            updated = outboxRepository.markSentIfClaimed(claim.id(), claim.claimedBy(), claim.claimedAt());
        } else {
            int retries = Math.min(delivery.retryCount() + 1, OutboxBackoff.MAX_ATTEMPTS);
            LocalDateTime next = LocalDateTime.now(clock).plus(OutboxBackoff.delayAfter(retries))
                    .truncatedTo(ChronoUnit.MILLIS);
            updated = outboxRepository.markFailedIfClaimed(claim.id(), claim.claimedBy(), claim.claimedAt(), retries, next);
        }
        if (updated == 0) {
            logger.warn("Outbox id={} was reclaimed while being sent; outcome ({}) discarded.",
                    claim.id(), delivered ? "SENT" : "FAILED");
        }
    }
}
