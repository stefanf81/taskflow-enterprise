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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NotificationListenerTest {

    @Mock
    private NotificationOutboxRepository outboxRepository;

    @InjectMocks
    private NotificationListener notificationListener;

    private Appointment appointment;

    @BeforeEach
    void setUp() {
        appointment = new Appointment(
                "John Doe",
                "john.doe@example.com",
                "123456789",
                "Barber Alex",
                LocalDate.of(2026, 7, 15),
                "10:00",
                "Haircut"
        );
        appointment.setId(1L);
    }

    @Test
    void testHandleAppointmentStatusChanged_Approved() {
        appointment.setStatus("APPROVED");
        AppointmentStatusChangedEvent event = new AppointmentStatusChangedEvent(this, appointment);

        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(invocation -> invocation.getArgument(0));

        notificationListener.handleAppointmentStatusChanged(event);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertNotNull(saved);
        assertEquals("john.doe@example.com", saved.getRecipient());
        assertEquals("EMAIL", saved.getType());
        assertTrue(saved.getMessage().contains("APPROVED"));
        assertEquals("SENT", saved.getStatus());
    }

    @Test
    void testHandleAppointmentStatusChanged_Denied() {
        appointment.setStatus("DENIED");
        AppointmentStatusChangedEvent event = new AppointmentStatusChangedEvent(this, appointment);

        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(invocation -> invocation.getArgument(0));

        notificationListener.handleAppointmentStatusChanged(event);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertNotNull(saved);
        assertEquals("john.doe@example.com", saved.getRecipient());
        assertTrue(saved.getMessage().contains("DECLINED"));
        assertEquals("SENT", saved.getStatus());
    }

    @Test
    void testHandleAppointmentStatusChanged_OtherStatus() {
        appointment.setStatus("PENDING");
        AppointmentStatusChangedEvent event = new AppointmentStatusChangedEvent(this, appointment);

        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(invocation -> invocation.getArgument(0));

        notificationListener.handleAppointmentStatusChanged(event);

        ArgumentCaptor<NotificationOutbox> captor = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(outboxRepository, times(1)).save(captor.capture());

        NotificationOutbox saved = captor.getValue();
        assertNotNull(saved);
        assertEquals("john.doe@example.com", saved.getRecipient());
        assertTrue(saved.getMessage().contains("PENDING"));
        assertEquals("SENT", saved.getStatus());
    }

    @Test
    void testHandleAppointmentStatusChanged_ExceptionHandling() {
        appointment.setStatus("APPROVED");
        AppointmentStatusChangedEvent event = new AppointmentStatusChangedEvent(this, appointment);

        when(outboxRepository.save(any(NotificationOutbox.class))).thenThrow(new RuntimeException("Database error"));

        // Exception is caught inside sendEmailNotification, so no exception should be thrown
        assertDoesNotThrow(() -> notificationListener.handleAppointmentStatusChanged(event));

        verify(outboxRepository, times(1)).save(any(NotificationOutbox.class));
    }

    @Test
    void testMasking_EdgeCases() {
        // Test null name and null/empty email
        Appointment badAppointment = new Appointment(
                null,
                null,
                "123456789",
                null,
                null,
                null,
                null
        );
        badAppointment.setStatus("APPROVED");
        AppointmentStatusChangedEvent event1 = new AppointmentStatusChangedEvent(this, badAppointment);
        when(outboxRepository.save(any(NotificationOutbox.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertDoesNotThrow(() -> notificationListener.handleAppointmentStatusChanged(event1));

        // Test empty email and short name
        Appointment badAppointment2 = new Appointment(
                "Jo",
                "",
                "123456789",
                "Alex",
                LocalDate.now(),
                "10:00",
                "Hair"
        );
        badAppointment2.setStatus("APPROVED");
        AppointmentStatusChangedEvent event2 = new AppointmentStatusChangedEvent(this, badAppointment2);
        assertDoesNotThrow(() -> notificationListener.handleAppointmentStatusChanged(event2));

        // Test invalid email format (no @)
        Appointment badAppointment3 = new Appointment(
                "John",
                "invalid_email",
                "123456789",
                "Alex",
                LocalDate.now(),
                "10:00",
                "Hair"
        );
        badAppointment3.setStatus("APPROVED");
        AppointmentStatusChangedEvent event3 = new AppointmentStatusChangedEvent(this, badAppointment3);
        assertDoesNotThrow(() -> notificationListener.handleAppointmentStatusChanged(event3));

        // Test short email local part (<= 2 chars)
        Appointment badAppointment4 = new Appointment(
                "John",
                "ab@test.com",
                "123456789",
                "Alex",
                LocalDate.now(),
                "10:00",
                "Hair"
        );
        badAppointment4.setStatus("APPROVED");
        AppointmentStatusChangedEvent event4 = new AppointmentStatusChangedEvent(this, badAppointment4);
        assertDoesNotThrow(() -> notificationListener.handleAppointmentStatusChanged(event4));

        verify(outboxRepository, times(4)).save(any(NotificationOutbox.class));
    }
}
