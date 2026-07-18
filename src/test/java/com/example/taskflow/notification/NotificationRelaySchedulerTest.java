package com.example.taskflow.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationRelaySchedulerTest {

    @Mock
    private NotificationOutboxRepository outboxRepository;

    @Mock
    private NotificationSender sender;

    private NotificationRelayScheduler relay;

    @BeforeEach
    void setUp() {
        relay = new NotificationRelayScheduler(outboxRepository, sender);
    }

    @Test
    void relayProcessesPendingAndRetryableFailedEntries() {
        NotificationOutbox pending = new NotificationOutbox("a@x.com", "EMAIL", "m1", LocalDateTime.now(), "PENDING");
        pending.setId(1L);
        NotificationOutbox failedRetriable = new NotificationOutbox("b@x.com", "EMAIL", "m2", LocalDateTime.now(), "FAILED");
        failedRetriable.setId(2L);
        failedRetriable.setRetryCount(1);

        when(outboxRepository.findByStatus("PENDING")).thenReturn(List.of(pending));
        when(outboxRepository.findByStatusAndRetryCountLessThan(eq("FAILED"), any(Integer.class)))
                .thenReturn(List.of(failedRetriable));

        relay.relay();

        verify(sender, times(1)).process(pending);
        verify(sender, times(1)).process(failedRetriable);
    }

    @Test
    void relaySkipsFailedEntriesPastRetryBudget() {
        NotificationOutbox exhausted = new NotificationOutbox("c@x.com", "EMAIL", "m3", LocalDateTime.now(), "FAILED");
        exhausted.setId(3L);
        exhausted.setRetryCount(5); // at the cap

        when(outboxRepository.findByStatus("PENDING")).thenReturn(List.of());
        when(outboxRepository.findByStatusAndRetryCountLessThan(eq("FAILED"), any(Integer.class)))
                .thenReturn(List.of());

        relay.relay();

        verify(sender, never()).process(any());
    }
}
