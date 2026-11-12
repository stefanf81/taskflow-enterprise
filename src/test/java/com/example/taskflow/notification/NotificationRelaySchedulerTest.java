package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.Pageable;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.LongStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationRelaySchedulerTest {

    private static final LocalDateTime SENT_AT = LocalDateTime.of(2031, 3, 10, 10, 0, 0);
    private static final Instant NOW = SENT_AT.toInstant(ZoneOffset.UTC);

    @Mock
    private NotificationOutboxRepository outboxRepository;

    @Mock
    private NotificationSender sender;

    @Mock
    @SuppressWarnings("unchecked")
    private ObjectProvider<NotificationRelayScheduler> selfProvider;

    private NotificationRelayScheduler relay;

    @BeforeEach
    void setUp() {
        // selfProvider returns null so relay() invokes claimBatch()/reclaimStaleClaims()
        // directly (the non-proxied branch). Transactional semantics are irrelevant
        // in this pure-mock unit test.
        lenient().when(selfProvider.getIfAvailable()).thenReturn(null);
        Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
        relay = new NotificationRelayScheduler(outboxRepository, sender, selfProvider, "test-instance", clock, true);
    }

    @Test
    void relayClaimsAndDispatchesClaimableEntriesWithTheirClaimToken() {
        NotificationOutbox pending = new NotificationOutbox("a@x.com", "EMAIL", "m1", SENT_AT, "PENDING");
        pending.setId(1L);
        NotificationOutbox failedRetriable = new NotificationOutbox("b@x.com", "EMAIL", "m2", SENT_AT, "FAILED");
        failedRetriable.setId(2L);
        failedRetriable.setRetryCount(1);

        when(outboxRepository.findClaimableForUpdate(anyInt(), any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of(pending, failedRetriable));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        // Claim query is evaluated against the clock's instant so rows in backoff are skipped. A short
        // batch means the backlog is drained: no second claim.
        verify(outboxRepository, times(1)).findClaimableForUpdate(eq(10), eq(NOW), any(Pageable.class));
        // Both go out in one gateway call (one SMTP session).
        verify(sender).process(List.of(new NotificationSender.Claim(1L, "test-instance", NOW),
                new NotificationSender.Claim(2L, "test-instance", NOW)));
        assertEquals("PROCESSING", pending.getStatus());
        assertEquals("test-instance", pending.getClaimedBy());
    }

    /** A burst larger than one batch goes out in one run instead of one batch per 30 s. */
    @Test
    void relayDrainsABacklogInConsecutiveBatches() {
        when(outboxRepository.findClaimableForUpdate(anyInt(), any(Instant.class), any(Pageable.class)))
                .thenReturn(pendingRows(0, NotificationRelayScheduler.CLAIM_BATCH_SIZE),
                        pendingRows(100, NotificationRelayScheduler.CLAIM_BATCH_SIZE),
                        pendingRows(200, 20));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        verify(outboxRepository, times(3)).findClaimableForUpdate(anyInt(), any(Instant.class), any(Pageable.class));
        // 50 + 50 + 20 rows in chunks of SEND_BATCH_SIZE (10): 5 + 5 + 2 sends.
        verify(sender, times(12)).process(anyList());
        verify(sender, never()).process(any(NotificationSender.Claim.class));
        verify(outboxRepository, times(1)).findStaleProcessing(any(Instant.class), any(Pageable.class));
    }

    @Test
    void relayStopsClaimingOnceTheDrainBudgetIsUsedUp() {
        NotificationRelayScheduler noBudget = new NotificationRelayScheduler(outboxRepository, sender, selfProvider,
                "test-instance", Clock.fixed(NOW, ZoneOffset.UTC), true, Duration.ZERO);
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());

        noBudget.relay();

        verify(outboxRepository, never()).findClaimableForUpdate(anyInt(), any(Instant.class), any(Pageable.class));
        verifyNoInteractions(sender);
        verify(outboxRepository).findStaleProcessing(any(), any());
    }

    @Test
    void relayStopsStartingSendsMidBatchAndReturnsUnstartedClaimsWithoutAnAttempt() {
        AtomicLong nanos = new AtomicLong();
        relay = new NotificationRelayScheduler(outboxRepository, sender, selfProvider, "test-instance",
                Clock.fixed(NOW, ZoneOffset.UTC), true,
                Duration.ofSeconds(20), nanos::get);
        when(outboxRepository.findClaimableForUpdate(anyInt(), any(), any()))
                .thenReturn(pendingRows(0, NotificationRelayScheduler.CLAIM_BATCH_SIZE));
        when(outboxRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        doAnswer(invocation -> {
            nanos.addAndGet(Duration.ofSeconds(11).toNanos());
            return null;
        }).when(sender).process(anyList());
        when(outboxRepository.findStaleProcessing(any(), any())).thenReturn(List.of());

        relay.relay();

        // Two chunks of 10 start (11 s each), the 30 claims after them go back without an attempt.
        verify(sender, times(2)).process(anyList());
        verify(outboxRepository, times(1)).findClaimableForUpdate(anyInt(), any(), any());
        verify(outboxRepository, times(30)).releaseIfClaimed(anyLong(), eq("test-instance"), eq(NOW));
        verify(outboxRepository, never()).releaseIfClaimed(eq(0L), any(), any());
        verify(outboxRepository, never()).releaseIfClaimed(eq(19L), any(), any());
        verify(outboxRepository).releaseIfClaimed(eq(20L), any(), any());
    }

    @Test
    void budgetExhaustedWhileClaimingDoesNotStartASend() {
        AtomicLong nanos = new AtomicLong();
        relay = new NotificationRelayScheduler(outboxRepository, sender, selfProvider, "test-instance",
                Clock.fixed(NOW, ZoneOffset.UTC), true,
                Duration.ofSeconds(20), nanos::get);
        when(outboxRepository.findClaimableForUpdate(anyInt(), any(), any())).thenAnswer(invocation -> {
            nanos.set(Duration.ofSeconds(21).toNanos());
            return pendingRows(1, 1);
        });
        when(outboxRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(outboxRepository.findStaleProcessing(any(), any())).thenReturn(List.of());

        relay.relay();

        verifyNoInteractions(sender);
        verify(outboxRepository).releaseIfClaimed(1L, "test-instance", NOW);
    }

    private static List<NotificationOutbox> pendingRows(long firstId, int count) {
        return LongStream.range(firstId, firstId + count).mapToObj(id -> {
            NotificationOutbox row = new NotificationOutbox("r" + id + "@x.com", "EMAIL", "m", SENT_AT, "PENDING");
            row.setId(id);
            return row;
        }).toList();
    }

    @Test
    void relaySkipsWhenNothingClaimable() {
        when(outboxRepository.findClaimableForUpdate(anyInt(), any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        verify(sender, never()).process(anyList());
    }

    @Test
    void scheduledRelayDoesNothingWhenSchedulersAreDisabled() {
        NotificationRelayScheduler disabled = new NotificationRelayScheduler(
                outboxRepository, sender, selfProvider, "off", Clock.systemUTC(), false);

        disabled.scheduledRelay();

        verifyNoInteractions(outboxRepository, sender);
    }

    @Test
    void reclaimCountsTheAbandonedAttemptAndBacksOff() {
        NotificationOutbox stale = staleRow(3L, 2);
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        relay.reclaimStaleClaims();

        // Stale threshold is 5 minutes before "now" as an Instant.
        verify(outboxRepository).findStaleProcessing(eq(NOW.minus(Duration.ofMinutes(5))), any(Pageable.class));
        assertEquals("PENDING", stale.getStatus());
        assertEquals(3, stale.getRetryCount());
        assertNull(stale.getClaimedAt());
        assertNull(stale.getClaimedBy());
        // 3rd failed attempt -> 30s * 2^2 = 120s
        assertEquals(NOW.plusSeconds(120), stale.getNextAttemptAt());
    }

    @Test
    void reclaimMovesRowToFailedWhenRetryCapIsReached() {
        NotificationOutbox stale = staleRow(4L, 9);
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        relay.reclaimStaleClaims();

        ArgumentCaptor<NotificationOutbox> saved = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository).save(saved.capture());
        assertEquals("FAILED", saved.getValue().getStatus());
        assertEquals(10, saved.getValue().getRetryCount());
    }

    @Test
    void reclaimNeverExceedsTheRetryCheckConstraint() {
        NotificationOutbox stale = staleRow(5L, 10);
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        relay.reclaimStaleClaims();

        assertEquals("FAILED", stale.getStatus());
        assertEquals(10, stale.getRetryCount()); // chk_outbox_retry: retry_count <= 10
    }

    @Test
    void springForwardDstTransitionDoesNotTreatFreshClaimAsStale() {
        java.time.ZoneId zurich = java.time.ZoneId.of("Europe/Zurich");
        // 2026-03-29 01:59:55 CET (00:59:55Z) -> +6s -> 03:00:01 CEST (01:00:01Z)
        Instant beforeJump = Instant.parse("2026-03-29T00:59:55Z");
        Instant afterJump = beforeJump.plusSeconds(6);
        NotificationRelayScheduler before = new NotificationRelayScheduler(
                outboxRepository, sender, selfProvider, "worker-1", Clock.fixed(beforeJump, zurich), true);
        NotificationRelayScheduler after = new NotificationRelayScheduler(
                outboxRepository, sender, selfProvider, "worker-2", Clock.fixed(afterJump, zurich), true);

        NotificationOutbox row = new NotificationOutbox("dst@x.com", "EMAIL", "m", SENT_AT, "PENDING");
        row.setId(9L);
        when(outboxRepository.findClaimableForUpdate(anyInt(), eq(beforeJump), any(Pageable.class)))
                .thenReturn(List.of(row));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        when(outboxRepository.findStaleProcessing(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());

        List<NotificationSender.Claim> claims = before.claimBatch();
        assertEquals(beforeJump, claims.getFirst().claimedAt());

        after.reclaimStaleClaims();
        ArgumentCaptor<Instant> threshold = ArgumentCaptor.forClass(Instant.class);
        verify(outboxRepository).findStaleProcessing(threshold.capture(), any(Pageable.class));
        // Threshold (00:55:01Z) is strictly before the 6-second-old claim (00:59:55Z).
        org.junit.jupiter.api.Assertions.assertTrue(threshold.getValue().isBefore(row.getClaimedAt()));
    }

    private static NotificationOutbox staleRow(long id, int retries) {
        NotificationOutbox row = new NotificationOutbox("c@x.com", "EMAIL", "m3", SENT_AT, "PROCESSING");
        row.setId(id);
        row.setRetryCount(retries);
        row.setClaimedAt(NOW.minus(Duration.ofMinutes(10)));
        row.setClaimedBy("dead-instance");
        return row;
    }
}
