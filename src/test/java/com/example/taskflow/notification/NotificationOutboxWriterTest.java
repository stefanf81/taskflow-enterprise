package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationOutboxWriterTest {

    @Mock
    private NotificationOutboxRepository outboxRepository;

    @InjectMocks
    private NotificationOutboxWriter writer;

    private Appointment appointment;

    @BeforeEach
    void setUp() {
        appointment = new Appointment("John Doe", "john@test.com", "123", "Barber Alex",
                LocalDate.now(), "10:00", "Haircut");
        appointment.setId(1L);
    }

    @Test
    void writerEnqueuesPendingOutboxOnStatusChange() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        appointment.setStatus("APPROVED");
        writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, appointment));

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox enqueued = captor.getValue();
        assertEquals("john@test.com", enqueued.getRecipient());
        assertEquals("EMAIL", enqueued.getType());
        assertEquals("PENDING", enqueued.getStatus());
        assertEquals(0, enqueued.getRetryCount());
        assertTrue(enqueued.getMessage().contains("APPROVED"));
    }

    @Test
    void writerDoesNotThrowWhenRepositoryFails() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        appointment.setStatus("DENIED");
        assertDoesNotThrow(() ->
                writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, appointment)));
    }
}
