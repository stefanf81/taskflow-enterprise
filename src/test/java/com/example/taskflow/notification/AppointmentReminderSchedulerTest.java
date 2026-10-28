package com.example.taskflow.notification;

import com.example.taskflow.appointment.AppointmentDetails;
import com.example.taskflow.appointment.AppointmentService;
import com.example.taskflow.appointment.AppointmentStatus;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import org.springframework.beans.factory.ObjectProvider;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.Collections;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Tests {@link AppointmentReminderScheduler}. The scheduler accesses appointments through the
 * {@link AppointmentService} public module API instead of the appointment module's internal
 * {@code AppointmentRepository} (Spring Modulith module boundary), so these tests mock the service.
 * "Tomorrow" comes from the injected shop {@link Clock}, here fixed at 2031-03-10 23:30 in
 * New York (= 2031-03-11 03:30 UTC) to prove the shop zone, not UTC, decides.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentReminderSchedulerTest {

    private static final ZoneId SHOP_ZONE = ZoneId.of("America/New_York");
    private static final LocalDate TOMORROW = LocalDate.of(2031, 3, 11);

    @Mock
    private AppointmentService appointmentService;

    @Mock
    private NotificationOutboxRepository notificationOutboxRepository;

    @Mock
    private ObjectProvider<AppointmentReminderScheduler> selfProvider;

    private AppointmentReminderScheduler reminderScheduler;

    private AppointmentDetails app1;
    private AppointmentDetails app2;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2031-03-11T03:30:00Z"), SHOP_ZONE);
        reminderScheduler = new AppointmentReminderScheduler(
                appointmentService, notificationOutboxRepository, selfProvider, clock, true);

        app1 = new AppointmentDetails(1L, "pub-1", "John Doe", "john.doe@example.com", "Barber Alex",
                "Haircut", TOMORROW, "10:00", AppointmentStatus.APPROVED);
        app2 = new AppointmentDetails(2L, "pub-2", "Jane Smith", null /* null e-mail must not break the sweep */,
                "Barber Sam", "Shave", TOMORROW, "11:00", AppointmentStatus.APPROVED);
    }

    @Test
    void testProcessReminders_QueuesPendingRowsForEveryClaimedAppointment() {
        when(selfProvider.getIfAvailable()).thenReturn(reminderScheduler);
        // 2031-03-10 23:30 in the shop => tomorrow is 03-11 (UTC "now" is already 03-11 => 03-12 if wrong)
        when(appointmentService.findAppointmentIdsNeedingReminders(TOMORROW))
                .thenReturn(Arrays.asList(1L, 2L));
        when(appointmentService.claimReminder(1L, TOMORROW)).thenReturn(Optional.of(app1));
        when(appointmentService.claimReminder(2L, TOMORROW)).thenReturn(Optional.of(app2));
        when(notificationOutboxRepository.save(any(NotificationOutbox.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        reminderScheduler.processReminders();

        ArgumentCaptor<NotificationOutbox> rows = ArgumentCaptor.forClass(NotificationOutbox.class);
        verify(notificationOutboxRepository, times(2)).save(rows.capture());
        // DATA-1: PENDING (not SENT) is what the relay claims; SENT rows were never delivered.
        rows.getAllValues().forEach(row -> {
            assertEquals("PENDING", row.getStatus());
            assertEquals("EMAIL", row.getType());
            assertEquals(0, row.getRetryCount());
            assertNull(row.getNextAttemptAt());
        });
        assertEquals("john.doe@example.com", rows.getAllValues().get(0).getRecipient());
        assertTrue(rows.getAllValues().get(0).getMessage().contains("tomorrow at 10:00"));

        verify(appointmentService, times(1)).findAppointmentIdsNeedingReminders(TOMORROW);
        verify(appointmentService, times(1)).claimReminder(1L, TOMORROW);
        verify(appointmentService, times(1)).claimReminder(2L, TOMORROW);
    }

    @Test
    void testProcessReminders_EmptyList() {
        when(appointmentService.findAppointmentIdsNeedingReminders(TOMORROW))
                .thenReturn(Collections.emptyList());

        reminderScheduler.processReminders();

        verify(notificationOutboxRepository, never()).save(any(NotificationOutbox.class));
        verify(appointmentService, never()).claimReminder(any(), any());
    }

    @Test
    void anAppointmentTheModuleDoesNotClaimGetsNoReminder() {
        // Denied/cancelled/moved/already reminded/vanished: the appointment module re-checks under
        // the row lock and answers empty (see AppointmentServiceImplTest), so no outbox row is written.
        when(appointmentService.claimReminder(1L, TOMORROW)).thenReturn(Optional.empty());

        reminderScheduler.processOne(1L);

        verify(notificationOutboxRepository, never()).save(any(NotificationOutbox.class));
    }

    @Test
    void tomorrowIsTheShopsTomorrowNotUtcs() {
        when(appointmentService.claimReminder(1L, TOMORROW)).thenReturn(Optional.of(app1));
        when(notificationOutboxRepository.save(any(NotificationOutbox.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        reminderScheduler.processOne(1L);

        verify(appointmentService).claimReminder(1L, TOMORROW);
        verify(notificationOutboxRepository).save(any(NotificationOutbox.class));
    }

    @Test
    void scheduledEntryPointDoesNothingWhenSchedulersAreDisabled() {
        AppointmentReminderScheduler off = new AppointmentReminderScheduler(
                appointmentService, notificationOutboxRepository, selfProvider, Clock.systemUTC(), false);

        off.scheduledReminders();

        verifyNoInteractions(appointmentService, notificationOutboxRepository);
    }
}
