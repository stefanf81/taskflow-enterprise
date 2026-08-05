package com.example.taskflow.notification;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Drains the transactional outbox: claims PENDING entries and re-attempts
 * FAILED entries that have not yet exhausted the retry budget.
 *
 * <p><b>Multi-instance safety.</b> Claiming uses {@code SELECT ... FOR UPDATE
 * SKIP LOCKED} (see {@link NotificationOutboxRepository#findClaimableForUpdate})
 * and immediately flips each row to {@code PROCESSING} with a recorded
 * {@code claimedBy} instance id. The claim transaction commits before dispatch,
 * so the locks are released and the rows are visible as claimed to other
 * instances. Two replicas can therefore drain the outbox concurrently without
 * delivering the same row twice.
 *
 * <p><b>Stale-claim reclaim.</b> If an instance crashes after claiming but
 * before resolving a row, it stays in {@code PROCESSING}. A reclaim sweep resets
 * rows stuck in {@code PROCESSING} longer than {@link #CLAIM_STALE_MINUTES} back
 * to {@code PENDING} for re-delivery.
 *
 * <p>Delivery itself is performed by {@link NotificationSender}, which records
 * the truthful outcome (SENT / FAILED + incremented retry counter) against the
 * row in its own transaction.
 */
@Component
public class NotificationRelayScheduler {

    private static final Logger logger = LoggerFactory.getLogger(NotificationRelayScheduler.class);
    private static final int MAX_RETRIES = 10;
    private static final int CLAIM_BATCH_SIZE = 50;
    static final int CLAIM_STALE_MINUTES = 5;

    private final NotificationOutboxRepository outboxRepository;
    private final NotificationSender sender;
    private final ObjectProvider<NotificationRelayScheduler> selfProvider;
    private final String instanceId;

    public NotificationRelayScheduler(NotificationOutboxRepository outboxRepository,
                                      NotificationSender sender,
                                      ObjectProvider<NotificationRelayScheduler> selfProvider,
                                      @Value("${app.instance.id:}") String instanceId) {
        this.outboxRepository = outboxRepository;
        this.sender = sender;
        this.selfProvider = selfProvider;
        this.instanceId = (instanceId != null && !instanceId.isBlank())
                ? instanceId
                : "relay-" + UUID.randomUUID();
    }

    @Scheduled(fixedDelay = 30000)
    public void relay() {
        NotificationRelayScheduler self = selfProvider.getIfAvailable();

        List<Long> claimedIds = self != null ? self.claimBatch() : claimBatch();
        if (!claimedIds.isEmpty()) {
            logger.info("Notification relay claimed {} outbox entr{} via {}", claimedIds.size(),
                    claimedIds.size() == 1 ? "y" : "ies", instanceId);
            for (Long id : claimedIds) {
                try {
                    sender.process(id);
                } catch (Exception e) {
                    String safeMsg = LogSanitizer.safeMessage(e);
                    logger.error("Relay failed to process outbox id={}: {}", id, safeMsg);
                }
            }
        }

        // Always reclaim stale PROCESSING rows, even when nothing was claimable
        // this cycle, so rows abandoned by a crashed instance are recovered.
        if (self != null) {
            self.reclaimStaleClaims();
        } else {
            reclaimStaleClaims();
        }
    }

    /**
     * Atomically claim a batch of claimable rows and mark them PROCESSING. Runs
     * in a dedicated transaction that commits before dispatch so the row locks
     * are released and other instances see the claimed state.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public List<Long> claimBatch() {
        List<NotificationOutbox> claimable = outboxRepository.findClaimableForUpdate(
                MAX_RETRIES, PageRequest.of(0, CLAIM_BATCH_SIZE));
        if (claimable.isEmpty()) {
            return List.of();
        }

        List<Long> ids = new ArrayList<>(claimable.size());
        LocalDateTime now = LocalDateTime.now();
        for (NotificationOutbox row : claimable) {
            row.setStatus("PROCESSING");
            row.setClaimedAt(now);
            row.setClaimedBy(instanceId);
            outboxRepository.save(row);
            ids.add(row.getId());
        }
        return ids;
    }

    /**
     * Reset rows stuck in PROCESSING longer than {@link #CLAIM_STALE_MINUTES}
     * back to PENDING so they are re-delivered.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void reclaimStaleClaims() {
        LocalDateTime threshold = LocalDateTime.now().minusMinutes(CLAIM_STALE_MINUTES);
        List<NotificationOutbox> stale = outboxRepository.findStaleProcessing(
                threshold, PageRequest.of(0, CLAIM_BATCH_SIZE));
        if (stale.isEmpty()) {
            return;
        }
        logger.warn("Reclaiming {} stale PROCESSING outbox rows older than {} min", stale.size(), CLAIM_STALE_MINUTES);
        for (NotificationOutbox row : stale) {
            row.setStatus("PENDING");
            row.setClaimedAt(null);
            row.setClaimedBy(null);
            outboxRepository.save(row);
        }
    }
}