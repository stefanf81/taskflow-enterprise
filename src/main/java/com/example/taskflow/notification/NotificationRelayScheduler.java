package com.example.taskflow.notification;

import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.SchedulerProperties;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.LongSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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
 * <p><b>Mail transport outage.</b> When the mail server cannot be reached at all (connection
 * refused or timed out, credentials rejected), no message is at fault: the sender returns the
 * chunk's claims without an attempt, the run returns its other claims the same way and stops, and
 * delivery pauses for {@link #TRANSPORT_PAUSE_BASE}, doubled per consecutive failure up to
 * {@link #TRANSPORT_PAUSE_MAX}. Counting those failures used to fail every queued message for
 * good once an outage outlasted the retry budget (about three hours).
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
    /**
     * Pause after the mail transport could not be reached at all, doubled per consecutive failure up
     * to {@link #TRANSPORT_PAUSE_MAX}. Such a failure counts no attempt (BENCHMARKS.md §75), so
     * without a pause every run would try a dead server again.
     */
    static final Duration TRANSPORT_PAUSE_BASE = Duration.ofSeconds(30);
    /** Longest pause: a recovered mail server is found again within this. */
    static final Duration TRANSPORT_PAUSE_MAX = Duration.ofMinutes(5);

    private final NotificationOutboxRepository outboxRepository;
    private final NotificationSender sender;
    private final ObjectProvider<NotificationRelayScheduler> selfProvider;
    private final String instanceId;
    private final Clock clock;
    private final boolean schedulersEnabled;
    private final long drainBudgetNanos;
    private final LongSupplier nanoTime;
    /** Consecutive runs that found the mail transport unreachable; 0 while it works. */
    private volatile int transportFailures;
    /** {@link #nanoTime} before which no batch is claimed; meaningful while transportFailures > 0. */
    private volatile long transportPausedUntil;

    @Autowired
    public NotificationRelayScheduler(
            NotificationOutboxRepository outboxRepository,
            NotificationSender sender,
            ObjectProvider<NotificationRelayScheduler> selfProvider,
            InstanceProperties instance,
            Clock clock,
            SchedulerProperties schedulers) {
        this(outboxRepository, sender, selfProvider, instance.id(), clock, schedulers.enabled());
    }

    NotificationRelayScheduler(
            NotificationOutboxRepository outboxRepository,
            NotificationSender sender,
            ObjectProvider<NotificationRelayScheduler> selfProvider,
            String instanceId,
            Clock clock,
            boolean schedulersEnabled) {
        this(outboxRepository, sender, selfProvider, instanceId, clock, schedulersEnabled, DRAIN_BUDGET);
    }

    NotificationRelayScheduler(
            NotificationOutboxRepository outboxRepository,
            NotificationSender sender,
            ObjectProvider<NotificationRelayScheduler> selfProvider,
            String instanceId,
            Clock clock,
            boolean schedulersEnabled,
            Duration drainBudget) {
        this(
                outboxRepository,
                sender,
                selfProvider,
                instanceId,
                clock,
                schedulersEnabled,
                drainBudget,
                System::nanoTime);
    }

    NotificationRelayScheduler(
            NotificationOutboxRepository outboxRepository,
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
        this.instanceId = (instanceId != null && !instanceId.isBlank()) ? instanceId : "relay-" + UUID.randomUUID();
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
        boolean transportDown = transportFailures > 0 && startedAt - transportPausedUntil < 0;
        while (!transportDown && hasBudget(startedAt)) {
            claims = self != null ? self.claimBatch() : claimBatch();
            if (claims.isEmpty()) {
                break;
            }
            logger.info(
                    "Notification relay claimed {} outbox entr{} via {}",
                    claims.size(),
                    claims.size() == 1 ? "y" : "ies",
                    instanceId);
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
                    transportReachable();
                } catch (TransportUnavailableException e) {
                    // The sender returned this chunk without an attempt; the rest of the run's
                    // claims go back the same way, and no further batch is claimed.
                    List<NotificationSender.Claim> unstarted =
                            claims.subList(Math.min(index + SEND_BATCH_SIZE, claims.size()), claims.size());
                    if (!unstarted.isEmpty()) {
                        if (self != null) {
                            self.releaseUnstartedClaims(unstarted);
                        } else {
                            releaseUnstartedClaims(unstarted);
                        }
                    }
                    pauseAfterTransportFailure(e);
                    transportDown = true;
                    break;
                } catch (Exception e) {
                    String safeMsg = LogSanitizer.safeMessage(e);
                    logger.error(
                            "Relay failed to process outbox ids {}..{}: {}",
                            chunk.getFirst().id(),
                            chunk.getLast().id(),
                            safeMsg);
                }
            }
            if (transportDown || claims.size() < CLAIM_BATCH_SIZE) {
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

    /** Doubles the pause per consecutive failure, up to {@link #TRANSPORT_PAUSE_MAX}. */
    private void pauseAfterTransportFailure(TransportUnavailableException e) {
        int failures = transportFailures + 1;
        Duration pause = TRANSPORT_PAUSE_BASE.multipliedBy(1L << Math.min(failures - 1, 20));
        if (pause.compareTo(TRANSPORT_PAUSE_MAX) > 0) {
            pause = TRANSPORT_PAUSE_MAX;
        }
        transportFailures = failures;
        transportPausedUntil = nanoTime.getAsLong() + pause.toNanos();
        // The cause's class only: mail exceptions can contain recipients or credentials.
        logger.warn(
                "Mail transport unavailable ({}); outbox delivery paused for {} s ({} failure(s) in a row). "
                        + "No delivery attempt was counted.",
                e.getCause() != null ? e.getCause().getClass().getSimpleName() : "unknown",
                pause.toSeconds(),
                failures);
    }

    private void transportReachable() {
        if (transportFailures > 0) {
            logger.info(
                    "Mail transport reachable again after {} failed run(s); outbox delivery resumed.",
                    transportFailures);
            transportFailures = 0;
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
        List<NotificationOutbox> claimable =
                outboxRepository.findClaimableForUpdate(MAX_RETRIES, now, PageRequest.of(0, CLAIM_BATCH_SIZE));
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
        List<NotificationOutbox> stale =
                outboxRepository.findStaleProcessing(threshold, PageRequest.of(0, CLAIM_BATCH_SIZE));
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
