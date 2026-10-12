package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Drains the transactional outbox: claims PENDING entries and re-attempts
 * FAILED entries that have not yet exhausted the retry budget and whose
 * backoff ({@code next_attempt_at}) has elapsed.
 *
 * <p><b>Multi-instance safety.</b> Claiming uses {@code SELECT ... FOR UPDATE
 * SKIP LOCKED} (see {@link NotificationOutboxRepository#findClaimableForUpdate})
 * and immediately flips each row to {@code PROCESSING} with a recorded
 * {@code claimedBy} instance id and {@code claimedAt}. The claim transaction commits before
 * dispatch, so the locks are released and the rows are visible as claimed to other
 * instances. {@link NotificationSender} only sends, and only records an outcome, while that
 * exact claim is still in place.
 *
 * <p><b>Stale-claim reclaim.</b> If an instance crashes or hangs after claiming but
 * before resolving a row, it stays in {@code PROCESSING}. A reclaim sweep (also
 * {@code SKIP LOCKED}) takes rows stuck longer than {@link #CLAIM_STALE_MINUTES}, counts the
 * abandoned attempt in {@code retry_count} and puts them back to {@code PENDING} with an
 * exponential backoff - or to {@code FAILED} once the retry cap is reached, so a payload that
 * keeps killing the sender cannot be retried forever.
 *
 * <p>Delivery itself is performed by {@link NotificationSender}.
 */
@Component
public class NotificationRelayScheduler {

    private static final Logger logger = LoggerFactory.getLogger(NotificationRelayScheduler.class);
    private static final int MAX_RETRIES = OutboxBackoff.MAX_ATTEMPTS;
    private static final int CLAIM_BATCH_SIZE = 50;
    static final int CLAIM_STALE_MINUTES = 5;

    private final NotificationOutboxRepository outboxRepository;
    private final NotificationSender sender;
    private final ObjectProvider<NotificationRelayScheduler> selfProvider;
    private final String instanceId;
    private final Clock clock;
    private final boolean schedulersEnabled;

    @Autowired
    public NotificationRelayScheduler(NotificationOutboxRepository outboxRepository,
                                      NotificationSender sender,
                                      ObjectProvider<NotificationRelayScheduler> selfProvider,
                                      @Value("${app.instance.id:}") String instanceId,
                                      Clock clock,
                                      @Value("${app.schedulers.enabled:true}") boolean schedulersEnabled) {
        this.outboxRepository = outboxRepository;
        this.sender = sender;
        this.selfProvider = selfProvider;
        this.instanceId = (instanceId != null && !instanceId.isBlank())
                ? instanceId
                : "relay-" + UUID.randomUUID();
        this.clock = clock;
        this.schedulersEnabled = schedulersEnabled;
    }

    /** Scheduler entry point; a no-op when {@code app.schedulers.enabled=false} (default for the test task). */
    @Scheduled(fixedDelay = 30000)
    public void scheduledRelay() {
        if (!schedulersEnabled) {
            return;
        }
        relay();
    }

    public void relay() {
        NotificationRelayScheduler self = selfProvider.getIfAvailable();

        List<NotificationSender.Claim> claims = self != null ? self.claimBatch() : claimBatch();
        if (!claims.isEmpty()) {
            logger.info("Notification relay claimed {} outbox entr{} via {}", claims.size(),
                    claims.size() == 1 ? "y" : "ies", instanceId);
            for (NotificationSender.Claim claim : claims) {
                try {
                    sender.process(claim);
                } catch (Exception e) {
                    String safeMsg = LogSanitizer.safeMessage(e);
                    logger.error("Relay failed to process outbox id={}: {}", claim.id(), safeMsg);
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
    public List<NotificationSender.Claim> claimBatch() {
        LocalDateTime now = now();
        List<NotificationOutbox> claimable = outboxRepository.findClaimableForUpdate(
                MAX_RETRIES, now, PageRequest.of(0, CLAIM_BATCH_SIZE));
        if (claimable.isEmpty()) {
            return List.of();
        }

        List<NotificationSender.Claim> claims = new ArrayList<>(claimable.size());
        for (NotificationOutbox row : claimable) {
            row.setStatus("PROCESSING");
            row.setClaimedAt(now);
            row.setClaimedBy(instanceId);
            outboxRepository.save(row);
            claims.add(new NotificationSender.Claim(row.getId(), instanceId, now));
        }
        return claims;
    }

    /**
     * Take back rows stuck in PROCESSING longer than {@link #CLAIM_STALE_MINUTES}. Each reclaim
     * counts as a failed attempt: below the retry cap the row returns to PENDING behind an
     * exponential backoff; at the cap it becomes FAILED and is never claimed again.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void reclaimStaleClaims() {
        LocalDateTime now = now();
        LocalDateTime threshold = now.minusMinutes(CLAIM_STALE_MINUTES);
        List<NotificationOutbox> stale = outboxRepository.findStaleProcessing(
                threshold, PageRequest.of(0, CLAIM_BATCH_SIZE));
        if (stale.isEmpty()) {
            return;
        }
        logger.warn("Reclaiming {} stale PROCESSING outbox rows older than {} min", stale.size(), CLAIM_STALE_MINUTES);
        for (NotificationOutbox row : stale) {
            int retries = Math.min(row.getRetryCount() + 1, MAX_RETRIES);
            row.setRetryCount(retries);
            if (retries >= MAX_RETRIES) {
                row.setStatus("FAILED");
                logger.error("Outbox id={} abandoned after {} attempts", row.getId(), retries);
            } else {
                row.setStatus("PENDING");
            }
            row.setNextAttemptAt(now.plus(OutboxBackoff.delayAfter(retries)).truncatedTo(ChronoUnit.MILLIS));
            row.setClaimedAt(null);
            row.setClaimedBy(null);
            outboxRepository.save(row);
        }
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock).truncatedTo(ChronoUnit.MILLIS);
    }
}
