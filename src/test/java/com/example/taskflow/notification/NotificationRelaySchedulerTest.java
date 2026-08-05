package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationRelaySchedulerTest {

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
        relay = new NotificationRelayScheduler(outboxRepository, sender, selfProvider, "test-instance");
    }

    @Test
    void relayClaimsAndDispatchesClaimableEntries() {
        NotificationOutbox pending = new NotificationOutbox("a@x.com", "EMAIL", "m1", LocalDateTime.now(), "PENDING");
        pending.setId(1L);
        NotificationOutbox failedRetriable = new NotificationOutbox("b@x.com", "EMAIL", "m2", LocalDateTime.now(), "FAILED");
        failedRetriable.setId(2L);
        failedRetriable.setRetryCount(1);

        when(outboxRepository.findClaimableForUpdate(anyInt(), any(Pageable.class)))
                .thenReturn(List.of(pending, failedRetriable));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        verify(sender, times(1)).process(1L);
        verify(sender, times(1)).process(2L);
    }

    @Test
    void relaySkipsWhenNothingClaimable() {
        when(outboxRepository.findClaimableForUpdate(anyInt(), any(Pageable.class)))
                .thenReturn(List.of());
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());

        relay.relay();

        verify(sender, never()).process(any());
    }

    @Test
    void reclaimResetsStaleProcessingRowsToPending() {
        NotificationOutbox stale = new NotificationOutbox("c@x.com", "EMAIL", "m3", LocalDateTime.now(), "PROCESSING");
        stale.setId(3L);
        stale.setClaimedAt(LocalDateTime.now().minusMinutes(10));
        stale.setClaimedBy("dead-instance");

        when(outboxRepository.findClaimableForUpdate(anyInt(), any(Pageable.class)))
                .thenReturn(List.of());
        when(outboxRepository.findStaleProcessing(any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        relay.relay();

        org.mockito.ArgumentCaptor<NotificationOutbox> captor =
                org.mockito.ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository).save(captor.capture());
        NotificationOutbox reclaimed = captor.getValue();
        org.junit.jupiter.api.Assertions.assertEquals("PENDING", reclaimed.getStatus());
        org.junit.jupiter.api.Assertions.assertNull(reclaimed.getClaimedAt());
        org.junit.jupiter.api.Assertions.assertNull(reclaimed.getClaimedBy());
    }
}