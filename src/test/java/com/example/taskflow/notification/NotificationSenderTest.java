package com.example.taskflow.notification;

import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.MailSendException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Map;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationSenderTest {

    private static final LocalDateTime SENT_AT = LocalDateTime.of(2031, 3, 10, 10, 0);
    private static final Instant NOW = SENT_AT.toInstant(ZoneOffset.UTC);
    private static final Instant CLAIMED_AT = NOW.minusSeconds(5);
    private static final String WORKER = "relay-1";

    @Mock private NotificationOutboxRepository outboxRepository;
    @Mock private NotificationGateway gateway;
    @Mock private PlatformTransactionManager transactions;

    private NotificationSender sender;
    private NotificationOutbox outbox;
    private NotificationSender.Claim claim;

    @BeforeEach
    void setUp() {
        outbox = new NotificationOutbox("john.doe@example.com", "EMAIL",
                "Subject: Appointment APPROVED - Dear John, your appointment has been APPROVED.", SENT_AT, "PROCESSING");
        outbox.setId(1L);
        outbox.setClaimedBy(WORKER);
        outbox.setClaimedAt(CLAIMED_AT);
        claim = new NotificationSender.Claim(1L, WORKER, CLAIMED_AT);
        when(transactions.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        sender = new NotificationSender(outboxRepository, gateway,
                Clock.fixed(NOW, ZoneOffset.UTC), transactions);
    }

    @Test
    void processMarksClaimedRowAsSentWithConditionalUpdate() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(1L, WORKER, CLAIMED_AT)).thenReturn(1);

        sender.process(claim);

        verify(gateway).send(new NotificationGateway.Message(1L, outbox.getRecipient(), "EMAIL", outbox.getMessage()));
        verify(outboxRepository).markSentIfClaimed(1L, WORKER, CLAIMED_AT);
        verify(outboxRepository, never()).save(any());
        verify(outboxRepository, never()).markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any());
        verify(transactions, times(2)).commit(any());
    }

    @Test
    void batchRecordsSentAndFailedPerRowFromOneGatewayCall() {
        NotificationOutbox second = claimedRow(2L);
        NotificationOutbox lost = claimedRow(3L);
        lost.setClaimedBy("another-worker");
        when(outboxRepository.findAllById(List.of(1L, 2L, 3L))).thenReturn(List.of(outbox, second, lost));
        when(gateway.sendAll(anyList())).thenReturn(Map.of(2L, new MailSendException("mailbox full")));
        when(outboxRepository.markSentIfClaimed(anyLong(), anyString(), any())).thenReturn(1);
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        sender.process(List.of(claim, new NotificationSender.Claim(2L, WORKER, CLAIMED_AT),
                new NotificationSender.Claim(3L, WORKER, CLAIMED_AT)));

        // One call for both rows this worker still owns; the row claimed elsewhere is not sent.
        verify(gateway).sendAll(List.of(
                new NotificationGateway.Message(1L, outbox.getRecipient(), "EMAIL", outbox.getMessage()),
                new NotificationGateway.Message(2L, second.getRecipient(), "EMAIL", second.getMessage())));
        verify(gateway, never()).send(any());
        verify(outboxRepository).markSentIfClaimed(1L, WORKER, CLAIMED_AT);
        verify(outboxRepository).markFailedIfClaimed(eq(2L), eq(WORKER), eq(CLAIMED_AT), eq(1), any());
        verify(outboxRepository, never()).markSentIfClaimed(eq(3L), any(), any());
        verify(outboxRepository, never()).markFailedIfClaimed(eq(3L), any(), any(), anyInt(), any());
    }

    @Test
    void batchCountsEveryRowAsFailedWhenTheGatewayItselfThrows() {
        when(outboxRepository.findAllById(List.of(1L))).thenReturn(List.of(outbox));
        when(gateway.sendAll(anyList())).thenThrow(new IllegalStateException("gateway broken"));
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        sender.process(List.of(claim));

        verify(outboxRepository).markFailedIfClaimed(eq(1L), eq(WORKER), eq(CLAIMED_AT), eq(1), any());
    }

    @Test
    void batchRecordsTheRemainingOutcomesWhenOneWriteFails() {
        NotificationOutbox second = claimedRow(2L);
        when(outboxRepository.findAllById(List.of(1L, 2L))).thenReturn(List.of(outbox, second));
        when(gateway.sendAll(anyList())).thenReturn(Map.of());
        when(outboxRepository.markSentIfClaimed(1L, WORKER, CLAIMED_AT))
                .thenThrow(new org.springframework.dao.QueryTimeoutException("db slow"));
        when(outboxRepository.markSentIfClaimed(2L, WORKER, CLAIMED_AT)).thenReturn(1);

        assertThrows(org.springframework.dao.QueryTimeoutException.class, () -> sender.process(
                List.of(claim, new NotificationSender.Claim(2L, WORKER, CLAIMED_AT))));

        // The delivered second row is still marked SENT, so stale-claim recovery cannot resend it.
        verify(outboxRepository).markSentIfClaimed(2L, WORKER, CLAIMED_AT);
    }

    private NotificationOutbox claimedRow(long id) {
        NotificationOutbox row = new NotificationOutbox("row" + id + "@example.com", "EMAIL", "m" + id, SENT_AT, "PROCESSING");
        row.setId(id);
        row.setClaimedBy(WORKER);
        row.setClaimedAt(CLAIMED_AT);
        return row;
    }

    @Test
    void processIncrementsRetryCountAndSchedulesBackoffWhenSmtpFails() {
        outbox.setRetryCount(2);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        doThrow(new MailSendException("SMTP unavailable")).when(gateway).send(any());
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        sender.process(claim);

        verify(outboxRepository).markFailedIfClaimed(1L, WORKER, CLAIMED_AT, 3, NOW.plusSeconds(120));
        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
    }

    @Test
    void unexpectedGatewayExceptionIsRecordedAsFailureNotLeftProcessing() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        doThrow(new IllegalStateException("gateway exploded")).when(gateway).send(any());
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        sender.process(claim);

        verify(outboxRepository).markFailedIfClaimed(1L, WORKER, CLAIMED_AT, 1, NOW.plusSeconds(30));
    }

    @Test
    void retryCountIsCappedAtTheCheckConstraint() {
        outbox.setRetryCount(10);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        doThrow(new MailSendException("offline")).when(gateway).send(any());
        when(outboxRepository.markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any())).thenReturn(1);

        sender.process(claim);

        verify(outboxRepository).markFailedIfClaimed(eq(1L), eq(WORKER), eq(CLAIMED_AT), eq(10), any());
    }

    @Test
    void processDoesNotSendWhenRowWasReclaimedByAnotherWorker() {
        outbox.setClaimedBy("relay-2");
        outbox.setClaimedAt(NOW);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));

        sender.process(claim);

        verifyNoInteractions(gateway);
        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
        verify(outboxRepository, never()).markFailedIfClaimed(anyLong(), anyString(), any(), anyInt(), any());
    }

    @Test
    void processDoesNotSendWhenRowIsNoLongerProcessing() {
        outbox.setStatus("PENDING");
        outbox.setClaimedBy(null);
        outbox.setClaimedAt(null);
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));

        sender.process(claim);

        verifyNoInteractions(gateway);
        verify(outboxRepository, never()).markSentIfClaimed(anyLong(), anyString(), any());
    }

    @Test
    void malformedClaimCannotSend() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        sender.process(new NotificationSender.Claim(1L, WORKER, null));
        sender.process(new NotificationSender.Claim(1L, null, CLAIMED_AT));
        verifyNoInteractions(gateway);
    }

    @Test
    void lateOutcomeOfAReclaimedRowIsDiscardedNotRethrown() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(1L, WORKER, CLAIMED_AT)).thenReturn(0);

        assertDoesNotThrow(() -> sender.process(claim));
        verify(outboxRepository, never()).save(any());
    }

    @Test
    void processPropagatesRepositoryFailureForStaleClaimRecovery() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.markSentIfClaimed(anyLong(), anyString(), any())).thenThrow(new RuntimeException("db error"));

        assertThrows(RuntimeException.class, () -> sender.process(claim));
        verify(transactions).rollback(any());
    }

    @Test
    void processSkipsMissingRowForEitherOverload() {
        when(outboxRepository.findById(99L)).thenReturn(Optional.empty());
        sender.process(new NotificationSender.Claim(99L, WORKER, CLAIMED_AT));
        sender.process(99L);
        verifyNoInteractions(gateway);
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
    void gatewayReceivesAnImmutableSnapshotNotTheManagedEntity() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        doAnswer(invocation -> {
            NotificationGateway.Message snapshot = invocation.getArgument(0);
            outbox.setRecipient("changed@example.com");
            outbox.setMessage("changed");
            assertEquals("john.doe@example.com", snapshot.recipient());
            assertTrue(snapshot.content().startsWith("Subject: Appointment APPROVED"));
            return null;
        }).when(gateway).send(any());
        sender.process(claim);
    }
}
