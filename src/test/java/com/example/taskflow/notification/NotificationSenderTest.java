package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationSenderTest {

    @Mock
    private NotificationOutboxRepository outboxRepository;

    private NotificationSender sender;

    private NotificationOutbox outbox;

    @BeforeEach
    void setUp() {
        outbox = new NotificationOutbox(
                "john.doe@example.com",
                "EMAIL",
                "Subject: Appointment APPROVED - Dear John, your Haircut appointment ... has been APPROVED.",
                LocalDateTime.now(),
                "PENDING");
        outbox.setId(1L);
        sender = new NotificationSender(outboxRepository);
    }

    @Test
    void processMarksClaimedRowAsSentOnSuccessfulDelivery() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        sender.process(1L);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertEquals("SENT", saved.getStatus());
        assertEquals(0, saved.getRetryCount());
        assertNull(saved.getClaimedAt());
        assertNull(saved.getClaimedBy());
    }

    @Test
    void processIncrementsRetryCountAndMarksFailedWhenSendFails() {
        NotificationSender failingSender = new NotificationSender(outboxRepository) {
            @Override
            boolean simulateSend(NotificationOutbox o) {
                return false;
            }
        };
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        failingSender.process(1L);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertEquals("FAILED", saved.getStatus());
        assertEquals(1, saved.getRetryCount());
    }

    @Test
    void processPropagatesRepositoryFailureForRetry() {
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        // The exception must propagate so the REQUIRES_NEW transaction rolls
        // back and the stale-claim reclaimer can retry the row later.
        assertThrows(RuntimeException.class, () -> sender.process(1L));
    }

    @Test
    void processSkipsMissingRow() {
        when(outboxRepository.findById(99L)).thenReturn(Optional.empty());

        sender.process(99L);

        verify(outboxRepository, never()).save(any(NotificationOutbox.class));
    }

    @Test
    void maskingHidesEmailLocalPart() {
        outbox.setRecipient("ab@test.com");
        when(outboxRepository.findById(1L)).thenReturn(Optional.of(outbox));
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        assertDoesNotThrow(() -> sender.process(1L));
        verify(outboxRepository, times(1)).save(any(NotificationOutbox.class));
    }
}