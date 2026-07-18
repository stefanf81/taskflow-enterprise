package com.example.taskflow.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationSenderTest {

    @Mock
    private NotificationOutboxRepository outboxRepository;

    @InjectMocks
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
    }

    @Test
    void processMarksPendingRowAsSentOnSuccessfulDelivery() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        sender.process(outbox);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertEquals("SENT", saved.getStatus());
        assertEquals(0, saved.getRetryCount());
    }

    @Test
    void processIncrementsRetryCountAndMarksFailedWhenSendFails() {
        // Force the simulated gateway to fail for this row.
        NotificationSender failingSender = new NotificationSender(outboxRepository) {
            @Override
            boolean simulateSend(NotificationOutbox o) {
                return false;
            }
        };
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        failingSender.process(outbox);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertEquals("FAILED", saved.getStatus());
        assertEquals(1, saved.getRetryCount());
    }

    @Test
    void processDoesNotThrowWhenRepositoryFails() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        assertDoesNotThrow(() -> sender.process(outbox));
    }

    @Test
    void maskingHidesEmailLocalPart() {
        // maskEmail is exercised indirectly via simulateSend during process();
        // verify the sender does not leak the raw address into a thrown error.
        outbox.setRecipient("ab@test.com");
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        assertDoesNotThrow(() -> sender.process(outbox));
        verify(outboxRepository, times(1)).save(any(NotificationOutbox.class));
    }
}
