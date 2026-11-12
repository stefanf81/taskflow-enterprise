package com.example.taskflow.notification;
import com.example.taskflow.core.SchedulerProperties;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.LongSupplier;

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
class NotificationRelayScheduler {

    private static final Logger logger = LoggerFactory.getLogger(NotificationRelayScheduler.class);
    private static final int MAX_RETRIES = OutboxBackoff.MAX_ATTEMPTS;
    static final int CLAIM_BATCH_SIZE = 50;
    static final int CLAIM_STALE_MINUTES = 5;
    /**
     * Claimed rows sent per gateway call, i.e. per SMTP session. One session per mail paid the TCP
     * and TLS handshake and the authentication for every message. Small enough that the drain
     * budget is still checked often, and that a connection dying mid-batch fails few messages.
     */
    static final int SEND_BATCH_SIZE = 10;
    /**
     * How long one run keeps claiming further batches while they come back full. One batch per
     * 30 s capped delivery below 100 mails a minute, so a burst (time off cancelling many
     * bookings, the reminder sweep) queued for minutes. Far below the stale-claim window, since
     * every batch is sent right after its own claim. It bounds starts of a {@link #SEND_BATCH_SIZE}
     * chunk, not an SMTP session in flight; that is bounded by the transport timeouts. Unstarted
     * claims are released without an attempt.
     */
    static final Duration DRAIN_BUDGET = Duration.ofSeconds(20);

    private final NotificationOutboxRepository outboxRepository;
    private final NotificationSender sender;
    private final ObjectProvider<NotificationRelayScheduler> selfProvider;
    private final String instanceId;
    private final Clock clock;
    private final boolean schedulersEnabled;
    private final long drainBudgetNanos;
    private final LongSupplier nanoTime;

    @Autowired
    public NotificationRelayScheduler(NotificationOutboxRepository outboxRepository,
                                      NotificationSender sender,
                                      ObjectProvider<NotificationRelayScheduler> selfProvider,
                                      InstanceProperties instance,
                                      Clock clock,
                                      SchedulerProperties schedulers) {
        this(outboxRepository, sender, selfProvider, instance.id(), clock, schedulers.enabled());
    }

    NotificationRelayScheduler(NotificationOutboxRepository outboxRepository,
                               NotificationSender sender,
                               ObjectProvider<NotificationRelayScheduler> selfProvider,
                               String instanceId,
                               Clock clock,
                               boolean schedulersEnabled) {
        this(outboxRepository, sender, selfProvider, instanceId, clock, schedulersEnabled, DRAIN_BUDGET);
    }

    NotificationRelayScheduler(NotificationOutboxRepository outboxRepository,
                               NotificationSender sender,
                               ObjectProvider<NotificationRelayScheduler> selfProvider,
                               String instanceId,
                               Clock clock,
                                boolean schedulersEnabled,
                                Duration drainBudget) {
        this(outboxRepository, sender, selfProvider, instanceId, clock, schedulersEnabled, drainBudget, System::nanoTime);
    }

    NotificationRelayScheduler(NotificationOutboxRepository outboxRepository,
                               NotificationSender sender,
                               ObjectProvider<NotificationRelayScheduler> selfProvider,
                               String instanceId,
                               Clock clock,
                               boolean schedulersEnabled,
                               Duration drainBudget,
                               LongSupplier nanoTime) {
        this.outboxRepository = outboxRepository;
        this.sender = sender;
        this.selfProvider = selfProvider;
        this.instanceId = (instanceId != null && !instanceId.isBlank())
                ? instanceId
                : "relay-" + UUID.randomUUID();
        this.clock = clock;
        this.schedulersEnabled = schedulersEnabled;
        this.drainBudgetNanos = drainBudget.toNanos();
        this.nanoTime = nanoTime;
    }

    /** Scheduler entry point; a no-op when {@code app.schedulers.enabled=false} (default for the test task). */
    @Scheduled(fixedDelay = 30000)
    public void scheduledRelay() {
        if (!schedulersEnabled) {
            return;
        }
        relay();
    }

    /**
     * Claims and sends batches until one comes back short (the backlog is drained) or
     * {@link #DRAIN_BUDGET} has passed. Every claimed row leaves the claimable set (SENT, FAILED
     * behind its backoff, or PROCESSING until reclaimed), so the loop cannot spin on the same rows.
     */
    public void relay() {
        NotificationRelayScheduler self = selfProvider.getIfAvailable();
        long startedAt = nanoTime.getAsLong();

        List<NotificationSender.Claim> claims;
        while (hasBudget(startedAt)) {
            claims = self != null ? self.claimBatch() : claimBatch();
            if (claims.isEmpty()) {
                break;
            }
            logger.info("Notification relay claimed {} outbox entr{} via {}", claims.size(),
                    claims.size() == 1 ? "y" : "ies", instanceId);
            for (int index = 0; index < claims.size(); index += SEND_BATCH_SIZE) {
                if (!hasBudget(startedAt)) {
                    List<NotificationSender.Claim> unstarted = claims.subList(index, claims.size());
                    if (self != null) {
                        self.releaseUnstartedClaims(unstarted);
                    } else {
                        releaseUnstartedClaims(unstarted);
                    }
                    break;
                }
                List<NotificationSender.Claim> chunk =
                        claims.subList(index, Math.min(index + SEND_BATCH_SIZE, claims.size()));
                try {
                    sender.process(chunk);
                } catch (Exception e) {
                    String safeMsg = LogSanitizer.safeMessage(e);
                    logger.error("Relay failed to process outbox ids {}..{}: {}", chunk.getFirst().id(),
                            chunk.getLast().id(), safeMsg);
                }
            }
            if (claims.size() < CLAIM_BATCH_SIZE) {
                break;
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

    private boolean hasBudget(long startedAt) {
        return nanoTime.getAsLong() - startedAt < drainBudgetNanos;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void releaseUnstartedClaims(List<NotificationSender.Claim> claims) {
        for (NotificationSender.Claim claim : claims) {
            outboxRepository.releaseIfClaimed(claim.id(), claim.claimedBy(), claim.claimedAt());
        }
    }

    /**
     * Atomically claim a batch of claimable rows and mark them PROCESSING. Runs
     * in a dedicated transaction that commits before dispatch so the row locks
     * are released and other instances see the claimed state.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public List<NotificationSender.Claim> claimBatch() {
        Instant now = now();
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
        Instant now = now();
        Instant threshold = now.minus(Duration.ofMinutes(CLAIM_STALE_MINUTES));
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

    private Instant now() {
        return Instant.now(clock).truncatedTo(ChronoUnit.MILLIS);
    }
}
