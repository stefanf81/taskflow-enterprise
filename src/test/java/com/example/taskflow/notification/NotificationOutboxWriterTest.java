package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentCancelledEvent;
import com.example.taskflow.appointment.AppointmentCancelledEvent.CancelledBy;
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
    void writerThrowsWhenRepositoryFailsToEnsureRollback() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        appointment.setStatus("DENIED");
        assertThrows(RuntimeException.class, () ->
                writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, appointment)));
    }

    private NotificationOutbox captureSaved() {
        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void cancellationWritesAProperCancelledMessageForEveryActor() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        appointment.setStatus("CANCELLED");

        for (CancelledBy actor : CancelledBy.values()) {
            reset(outboxRepository);
            when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

            writer.handleAppointmentCancelled(new AppointmentCancelledEvent(appointment, actor));

            NotificationOutbox enqueued = captureSaved();
            assertEquals("john@test.com", enqueued.getRecipient());
            assertEquals("PENDING", enqueued.getStatus());
            assertTrue(enqueued.getMessage().contains(
                    "your Haircut appointment with Barber Alex on " + LocalDate.now() + " at 10:00 has been cancelled"),
                    enqueued.getMessage());
            assertTrue(enqueued.getMessage().startsWith("Subject: Appointment CANCELLED"), enqueued.getMessage());
        }
    }

    @Test
    void barberUnavailableCancellationExplainsWhy() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        writer.handleAppointmentCancelled(new AppointmentCancelledEvent(appointment, CancelledBy.BARBER_UNAVAILABLE));

        assertTrue(captureSaved().getMessage().contains("Barber Alex is unavailable on that day"));
    }

    @Test
    void cancellationTimeIsShownAsHhMmEvenWhenStoredWithSeconds() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        appointment.setBookingTime("10:00:00");

        writer.handleAppointmentCancelled(new AppointmentCancelledEvent(appointment, CancelledBy.GUEST));

        assertTrue(captureSaved().getMessage().contains(" at 10:00 has been cancelled"));
    }

    @Test
    void statusChangeBranchHandlesCancelledDefensively() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        appointment.setStatus("CANCELLED");

        writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, appointment));

        String message = captureSaved().getMessage();
        assertTrue(message.contains("has been cancelled"), message);
        assertFalse(message.contains("status has been updated"), message);
    }

    @Test
    void cancellationWriterThrowsWhenRepositoryFails() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        assertThrows(RuntimeException.class, () ->
                writer.handleAppointmentCancelled(new AppointmentCancelledEvent(appointment, CancelledBy.ADMIN)));
    }
}
