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
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationRelaySchedulerTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2031, 3, 10, 10, 0, 0);

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
        Clock clock = Clock.fixed(NOW.toInstant(ZoneOffset.UTC), ZoneOffset.UTC);
        relay = new NotificationRelayScheduler(outboxRepository, sender, selfProvider, "test-instance", clock, true);
    }

    @Test
    void relayClaimsAndDispatchesClaimableEntriesWithTheirClaimToken() {
        NotificationOutbox pending = new NotificationOutbox("a@x.com", "EMAIL", "m1", NOW, "PENDING");
        pending.setId(1L);
        NotificationOutbox failedRetriable = new NotificationOutbox("b@x.com", "EMAIL", "m2", NOW, "FAILED");
        failedRetriable.setId(2L);
        failedRetriable.setRetryCount(1);

        when(outboxRepository.findClaimableForUpdate(anyInt(), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(pending, failedRetriable));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        // Claim query is evaluated against the shop clock so rows in backoff are skipped.
        verify(outboxRepository).findClaimableForUpdate(eq(10), eq(NOW), any(Pageable.class));
        verify(sender).process(new NotificationSender.Claim(1L, "test-instance", NOW));
        verify(sender).process(new NotificationSender.Claim(2L, "test-instance", NOW));
        assertEquals("PROCESSING", pending.getStatus());
        assertEquals("test-instance", pending.getClaimedBy());
    }

    @Test
    void relaySkipsWhenNothingClaimable() {
        when(outboxRepository.findClaimableForUpdate(anyInt(), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        verify(sender, never()).process(any(NotificationSender.Claim.class));
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
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        relay.reclaimStaleClaims();

        // Stale threshold is 5 minutes before "now" on the shop clock.
        verify(outboxRepository).findStaleProcessing(eq(NOW.minusMinutes(5)), any(Pageable.class));
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
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
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
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        relay.reclaimStaleClaims();

        assertEquals("FAILED", stale.getStatus());
        assertEquals(10, stale.getRetryCount()); // chk_outbox_retry: retry_count <= 10
    }

    private static NotificationOutbox staleRow(long id, int retries) {
        NotificationOutbox row = new NotificationOutbox("c@x.com", "EMAIL", "m3", NOW, "PROCESSING");
        row.setId(id);
        row.setRetryCount(retries);
        row.setClaimedAt(NOW.minusMinutes(10));
        row.setClaimedBy("dead-instance");
        return row;
    }
}
