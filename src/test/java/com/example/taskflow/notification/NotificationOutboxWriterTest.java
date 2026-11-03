package com.example.taskflow.notification;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.AppointmentCancelledEvent;
import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentCancelledEvent.CancelledBy;
import com.example.taskflow.appointment.AppointmentStatusChangedEvent;
import com.example.taskflow.testsupport.AppointmentDetailsFixtures;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationOutboxWriterTest {

    @Mock
    private NotificationOutboxRepository outboxRepository;

    /** 2026-03-02T23:30Z is already 2026-03-03 in the shop's zone (UTC+1). */
    private static final Clock SHOP_CLOCK =
            Clock.fixed(Instant.parse("2026-03-02T23:30:00Z"), ZoneId.of("Europe/Berlin"));

    private NotificationOutboxWriter writer;

    private Appointment appointment;

    @BeforeEach
    void setUp() {
        writer = new NotificationOutboxWriter(outboxRepository, SHOP_CLOCK);
        appointment = new Appointment("John Doe", "john@test.com", "123", "Barber Alex",
                LocalDate.now(), "10:00", "Haircut");
        appointment.setId(1L);
    }

    @Test
    void writerEnqueuesPendingOutboxOnStatusChange() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));

        appointment.setStatus("APPROVED");
        writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(appointment)));

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
    void sentAtUsesTheShopClockNotTheJvmZone() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        LocalDateTime shopNow = LocalDateTime.of(2026, 3, 3, 0, 30);

        appointment.setStatus("APPROVED");
        writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(appointment)));
        assertEquals(shopNow, captureSaved().getSentAt());

        clearInvocations(outboxRepository);
        appointment.setStatus("CANCELLED");
        writer.handleAppointmentCancelled(new AppointmentCancelledEvent(AppointmentDetailsFixtures.of(appointment), CancelledBy.GUEST));
        assertEquals(shopNow, captureSaved().getSentAt());
    }

    @Test
    void writerThrowsWhenRepositoryFailsToEnsureRollback() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        appointment.setStatus("DENIED");
        assertThrows(RuntimeException.class, () ->
                writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(appointment))));
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

            writer.handleAppointmentCancelled(new AppointmentCancelledEvent(AppointmentDetailsFixtures.of(appointment), actor));

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

        writer.handleAppointmentCancelled(new AppointmentCancelledEvent(AppointmentDetailsFixtures.of(appointment), CancelledBy.BARBER_UNAVAILABLE));

        assertTrue(captureSaved().getMessage().contains("Barber Alex is unavailable on that day"));
    }

    @Test
    void cancellationTimeIsShownAsHhMmEvenWhenStoredWithSeconds() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        appointment.setBookingTime("10:00:00");

        writer.handleAppointmentCancelled(new AppointmentCancelledEvent(AppointmentDetailsFixtures.of(appointment), CancelledBy.GUEST));

        assertTrue(captureSaved().getMessage().contains(" at 10:00 has been cancelled"));
    }

    @Test
    void statusChangeBranchHandlesCancelledDefensively() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        appointment.setStatus("CANCELLED");

        writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, AppointmentDetailsFixtures.of(appointment)));

        String message = captureSaved().getMessage();
        assertTrue(message.contains("has been cancelled"), message);
        assertFalse(message.contains("status has been updated"), message);
    }

    @Test
    void aSnapshotWithoutStatusIsTreatedAsPendingInsteadOfFailingTheTransaction() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(inv -> inv.getArgument(0));
        AppointmentDetails noStatus = new AppointmentDetails(1L, "pub-1", "John Doe", "john@test.com",
                "Barber Alex", "Haircut", LocalDate.now(), "10:00", null);

        writer.handleAppointmentStatusChanged(new AppointmentStatusChangedEvent(this, noStatus));

        assertTrue(captureSaved().getMessage().contains("PENDING"));
    }

    @Test
    void cancellationWriterThrowsWhenRepositoryFails() {
        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("db error"));

        assertThrows(RuntimeException.class, () ->
                writer.handleAppointmentCancelled(new AppointmentCancelledEvent(AppointmentDetailsFixtures.of(appointment), CancelledBy.ADMIN)));
    }
}
