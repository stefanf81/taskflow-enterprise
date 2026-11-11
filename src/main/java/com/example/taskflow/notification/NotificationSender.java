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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

    /**
     * Sends several claimed rows in one gateway call (one SMTP session), then records each outcome
     * in its own transaction like {@link #process(Claim)}. A claim that was lost meanwhile is skipped.
     * Outcomes are recorded for every row even when one of those writes fails (that failure is
     * rethrown afterwards), so a database error cannot leave delivered rows PROCESSING to be sent
     * again by the stale-claim recovery.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void process(List<Claim> claims) {
        if (claims.isEmpty()) {
            return;
        }
        List<Delivery> deliveries = readTransaction.execute(status -> {
            Map<Long, NotificationOutbox> rows = new HashMap<>();
            for (NotificationOutbox row : outboxRepository.findAllById(claims.stream().map(Claim::id).toList())) {
                rows.put(row.getId(), row);
            }
            List<Delivery> owned = new ArrayList<>(claims.size());
            for (Claim claim : claims) {
                Delivery delivery = snapshot(claim.id(), claim, rows.get(claim.id()));
                if (delivery != null) {
                    owned.add(delivery);
                }
            }
            return owned;
        });
        if (deliveries == null || deliveries.isEmpty()) {
            return;
        }
        Map<Long, RuntimeException> failed;
        try {
            failed = gateway.sendAll(deliveries.stream().map(Delivery::message).toList());
        } catch (RuntimeException e) {
            failed = new HashMap<>();
            for (Delivery delivery : deliveries) {
                failed.put(delivery.claim().id(), e);
            }
        }
        RuntimeException recordFailure = null;
        for (Delivery delivery : deliveries) {
            RuntimeException cause = failed.get(delivery.claim().id());
            if (cause != null) {
                logger.warn("Dispatch failed for outbox id={} ({})", delivery.claim().id(),
                        cause.getClass().getSimpleName());
            }
            try {
                outcomeTransaction.executeWithoutResult(status -> recordOutcome(delivery, cause == null));
            } catch (RuntimeException e) {
                if (recordFailure == null) {
                    recordFailure = e;
                } else {
                    recordFailure.addSuppressed(e);
                }
            }
        }
        if (recordFailure != null) {
            throw recordFailure;
        }
    }

    private @Nullable Delivery snapshot(Long id, @Nullable Claim expected) {
        return snapshot(id, expected, outboxRepository.findById(id).orElse(null));
    }

    private @Nullable Delivery snapshot(Long id, @Nullable Claim expected, @Nullable NotificationOutbox row) {
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
