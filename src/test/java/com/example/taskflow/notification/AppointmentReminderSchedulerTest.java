package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AppointmentReminderSchedulerTest {

    @Mock
    private AppointmentRepository appointmentRepository;

    @Mock
    private NotificationOutboxRepository notificationOutboxRepository;

    @InjectMocks
    private AppointmentReminderScheduler reminderScheduler;

    private Appointment app1;
    private Appointment app2;

    @BeforeEach
    void setUp() {
        app1 = new Appointment(
                "John Doe",
                "john.doe@example.com",
                "123456789",
                "Barber Alex",
                LocalDate.now().plusDays(1),
                "10:00",
                "Haircut"
        );
        app1.setId(1L);
        app1.setReminderSent(false);
        app1.setStatus("APPROVED");

        app2 = new Appointment(
                "Jane Smith",
                null, // test null customer email
                "987654321",
                "Barber Sam",
                LocalDate.now().plusDays(1),
                "11:00",
                "Shave"
        );
        app2.setId(2L);
        app2.setReminderSent(false);
        app2.setStatus("APPROVED");
    }

    @Test
    void testProcessReminders_Success() {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        when(appointmentRepository.findReminderIds(tomorrow, false, "APPROVED"))
                .thenReturn(Arrays.asList(1L, 2L));
        when(appointmentRepository.findByIdForUpdate(1L)).thenReturn(java.util.Optional.of(app1));
        when(appointmentRepository.findByIdForUpdate(2L)).thenReturn(java.util.Optional.of(app2));

        when(notificationOutboxRepository.save(any(NotificationOutbox.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(appointmentRepository.save(any(Appointment.class))).thenAnswer(invocation -> invocation.getArgument(0));

        reminderScheduler.processReminders();

        // Check if reminders are marked as sent
        assertTrue(app1.getReminderSent());
        assertTrue(app2.getReminderSent());

        // Check save calls
        verify(notificationOutboxRepository, times(2)).save(any(NotificationOutbox.class));
        verify(appointmentRepository, times(1)).save(app1);
        verify(appointmentRepository, times(1)).save(app2);

        // Verify the per-appointment ID loader is used (A5: lock released per row)
        verify(appointmentRepository, times(1)).findReminderIds(tomorrow, false, "APPROVED");
        verify(appointmentRepository, times(1)).findByIdForUpdate(1L);
        verify(appointmentRepository, times(1)).findByIdForUpdate(2L);
    }

    @Test
    void testProcessReminders_EmptyList() {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        when(appointmentRepository.findReminderIds(tomorrow, false, "APPROVED"))
                .thenReturn(Collections.emptyList());

        reminderScheduler.processReminders();

        verify(notificationOutboxRepository, never()).save(any(NotificationOutbox.class));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }
}
