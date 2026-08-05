package com.example.taskflow.notification;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentService;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import org.springframework.beans.factory.ObjectProvider;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Tests {@link AppointmentReminderScheduler}. The scheduler was refactored to
 * access appointments through the {@link AppointmentService} public module API
 * instead of the appointment module's internal {@code AppointmentRepository}
 * (Spring Modulith module boundary), so these tests mock the service rather
 * than the repository.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentReminderSchedulerTest {

    @Mock
    private AppointmentService appointmentService;

    @Mock
    private NotificationOutboxRepository notificationOutboxRepository;

    @Mock
    private ObjectProvider<AppointmentReminderScheduler> selfProvider;

    private AppointmentReminderScheduler reminderScheduler;

    private Appointment app1;
    private Appointment app2;

    @BeforeEach
    void setUp() {
        reminderScheduler = new AppointmentReminderScheduler(
                appointmentService, notificationOutboxRepository, selfProvider);

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
        when(selfProvider.getIfAvailable()).thenReturn(reminderScheduler);
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        when(appointmentService.findAppointmentIdsNeedingReminders(tomorrow))
                .thenReturn(Arrays.asList(1L, 2L));
        when(appointmentService.lockForReminder(1L)).thenReturn(Optional.of(app1));
        when(appointmentService.lockForReminder(2L)).thenReturn(Optional.of(app2));

        when(notificationOutboxRepository.save(any(NotificationOutbox.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        reminderScheduler.processReminders();

        // Check if reminders are marked as sent
        assertTrue(app1.getReminderSent());
        assertTrue(app2.getReminderSent());

        // The scheduler marks each appointment via the appointment module's
        // public save() API (no longer touching the internal repository).
        verify(notificationOutboxRepository, times(2)).save(any(NotificationOutbox.class));
        verify(appointmentService, times(1)).save(app1);
        verify(appointmentService, times(1)).save(app2);

        // Verify the per-appointment ID loader is used (A5: lock released per row)
        verify(appointmentService, times(1)).findAppointmentIdsNeedingReminders(tomorrow);
        verify(appointmentService, times(1)).lockForReminder(1L);
        verify(appointmentService, times(1)).lockForReminder(2L);
    }

    @Test
    void testProcessReminders_EmptyList() {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        when(appointmentService.findAppointmentIdsNeedingReminders(tomorrow))
                .thenReturn(Collections.emptyList());

        reminderScheduler.processReminders();

        verify(notificationOutboxRepository, never()).save(any(NotificationOutbox.class));
        verify(appointmentService, never()).save(any(Appointment.class));
    }
}