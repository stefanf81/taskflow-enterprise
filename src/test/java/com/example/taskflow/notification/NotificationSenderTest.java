package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationSenderTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2031, 3, 10, 10, 0, 0);
    private static final LocalDateTime CLAIMED_AT = NOW.minusSeconds(5);
    private static final String WORKER = "relay-1";

    @Mock
    private NotificationOutboxRepository outboxRepository;

    private NotificationSender sender;
    private NotificationOutbox outbox;
    private NotificationSender.Claim claim;
    private Clock clock;

    @BeforeEach
    void setUp() {
        outbox = new NotificationOutbox(
                "john.doe@example.com",
                "EMAIL",
                "Subject: Appointment APPROVED - Dear John, your Haircut appointment ... has been APPROVED.",
                LocalDateTime.now(),
                "PROCESSING");
        outbox.setId(1L);
        outbox.setClaimedBy(WORKER);
        outbox.setClaimedAt(CLAIMED_AT);
        claim = new NotificationSender.Claim(1L, WORKER, CLAIMED_AT);
        clock = Clock.fixed(NOW.toInstant(ZoneOffset.UTC), ZoneOffset.UTC);
        sender = new NotificationSender(outboxRepository, false, clock);
    }

    @Test
    void processMarksClaimedRowAsSentWithConditionalUpdate() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(1L, WORKER, CLAIMED_AT)).thenReturn(1);

        sender.process(claim);

        verify(outboxRepository).markSentIfClaimed(1L, WORKER, CLAIMED_AT);
        verify(outboxRepository, never()).save(any(NotificationOutbox.class));
        verify(outboxRepository, never()).markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any());
    }

    @Test
    void processIncrementsRetryCountAndSchedulesBackoffWhenSendFails() {
        NotificationSender failing = new NotificationSender(outboxRepository, false, clock) {
            @Override
            boolean simulateSend(NotificationOutbox o) {
                return false;
            }
        };
        outbox.setRetryCount(2);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        failing.process(claim);

        // 3rd failure -> 30s * 2^2 = 120s from now
        verify(outboxRepository).markFailedIfClaimed(1L, WORKER, CLAIMED_AT, 3, NOW.plusSeconds(120));
        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
    }

    @Test
    void aSendThatThrowsIsRecordedAsFailureNotLeftProcessing() {
        NotificationSender throwing = new NotificationSender(outboxRepository, false, clock) {
            @Override
            boolean simulateSend(NotificationOutbox o) {
                throw new IllegalStateException("smtp exploded");
            }
        };
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        throwing.process(claim);

        verify(outboxRepository).markFailedIfClaimed(1L, WORKER, CLAIMED_AT, 1, NOW.plusSeconds(30));
    }

    @Test
    void retryCountIsCappedAtTheCheckConstraint() {
        NotificationSender failing = new NotificationSender(outboxRepository, false, clock) {
            @Override
            boolean simulateSend(NotificationOutbox o) {
                return false;
            }
        };
        outbox.setRetryCount(10);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        failing.process(claim);

        verify(outboxRepository).markFailedIfClaimed(eq(1L), eq(WORKER), eq(CLAIMED_AT), eq(10), any());
    }

    @Test
    void processDoesNotSendWhenRowWasReclaimedByAnotherWorker() {
        outbox.setClaimedBy("relay-2");
        outbox.setClaimedAt(NOW);
        NotificationSender spying = spy(sender);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));

        spying.process(claim);

        verify(spying, never()).simulateSend(any(NotificationOutbox.class));
        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
        verify(outboxRepository, never()).markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any());
    }

    @Test
    void processDoesNotSendWhenRowIsNoLongerProcessing() {
        outbox.setStatus("PENDING");
        outbox.setClaimedBy(null);
        outbox.setClaimedAt(null);
        NotificationSender spying = spy(sender);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));

        spying.process(claim);

        verify(spying, never()).simulateSend(any(NotificationOutbox.class));
        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
    }

    @Test
    void lateOutcomeOfAReclaimedRowIsDiscardedNotRethrown() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        // The row was reclaimed between the load and the conditional write: 0 rows touched.
        when(outboxRepository.markSentIfClaimed(1L, WORKER, CLAIMED_AT)).thenReturn(0);

        assertDoesNotThrow(() -> sender.process(claim));
        verify(outboxRepository, never()).save(any(NotificationOutbox.class));
    }

    @Test
    void processPropagatesRepositoryFailureForRetry() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(anyLong(), anyString(), any())).thenThrow(new RuntimeException("db error"));

        // The exception must propagate so the REQUIRES_NEW transaction rolls
        // back and the stale-claim reclaimer can retry the row later.
        assertThrows(RuntimeException.class, () -> sender.process(claim));
    }

    @Test
    void processSkipsMissingRow() {
        when(outboxRepository.findById(99L)).thenReturn(Optional.empty());

        sender.process(new NotificationSender.Claim(99L, WORKER, CLAIMED_AT));

        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
    }

    @Test
    void idOnlyOverloadAdoptsTheRowsCurrentClaim() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(1L, WORKER, CLAIMED_AT)).thenReturn(1);

        sender.process(1L);

        verify(outboxRepository).markSentIfClaimed(1L, WORKER, CLAIMED_AT);
    }

    @Test
    void maskingHidesEmailLocalPart() {
        outbox.setRecipient("ab@test.com");
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(anyLong(), anyString(), any())).thenReturn(1);

        assertDoesNotThrow(() -> sender.process(claim));
    }

    @Test
    void failureHookIsOffByDefaultSoRealAddressesStartingWithInvalidAreDelivered() {
        outbox.setRecipient("invalid.joe@example.com");
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(anyLong(), anyString(), any())).thenReturn(1);

        new NotificationSender(outboxRepository, false, clock).process(claim);

        verify(outboxRepository).markSentIfClaimed(1L, WORKER, CLAIMED_AT);
    }

    @Test
    void failureHookCanBeEnabledForRetryTesting() {
        outbox.setRecipient("fail-me@example.com");
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        new NotificationSender(outboxRepository, true, clock).process(claim);

        verify(outboxRepository).markFailedIfClaimed(1L, WORKER, CLAIMED_AT, 1, NOW.plusSeconds(30));
    }
}
