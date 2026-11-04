package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.SliceImpl;
import org.springframework.data.jpa.domain.Specification;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** {@link AppointmentServiceImpl}: the cross-module API used by {@code notification} and {@code review}. */
class AppointmentServiceImplTest extends AppointmentServiceTestSupport {

    @Test
    void claimReminderMarksAnApprovedBookingForTomorrowAsSentAndReturnsIt() {
        Appointment approved = appointment(1, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        approved.setReminderSent(false);
        when(appointmentRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(approved));

        Optional<AppointmentDetails> claimed = appointmentService.claimReminder(1L, TOMORROW);

        assertTrue(claimed.isPresent());
        assertEquals("john@test.com", claimed.get().customerEmail());
        assertEquals(AppointmentStatus.APPROVED, claimed.get().status());
        assertTrue(approved.getReminderSent());
        verify(appointmentRepository).save(approved);
    }

    @Test
    void claimReminderSkipsBookingsThatNoLongerQualifyUnderTheLock() {
        Appointment cancelled = appointment(2, AppointmentStatus.CANCELLED, TOMORROW, "10:00");
        Appointment denied = appointment(3, AppointmentStatus.DENIED, TOMORROW, "10:00");
        Appointment pending = appointment(4, AppointmentStatus.PENDING, TOMORROW, "10:00");
        Appointment moved = appointment(5, AppointmentStatus.APPROVED, TOMORROW.plusDays(3), "10:00");
        Appointment alreadySent = appointment(6, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        alreadySent.setReminderSent(true);
        for (Appointment a : List.of(cancelled, denied, pending, moved, alreadySent)) {
            when(appointmentRepository.findByIdForUpdate(a.getId())).thenReturn(Optional.of(a));
        }
        when(appointmentRepository.findByIdForUpdate(9L)).thenReturn(Optional.empty());

        for (long id : new long[] {2, 3, 4, 5, 6, 9}) {
            assertTrue(appointmentService.claimReminder(id, TOMORROW).isEmpty(), "id " + id);
        }
        assertNotEquals(Boolean.TRUE, cancelled.getReminderSent());
        assertNotEquals(Boolean.TRUE, moved.getReminderSent());
        verify(appointmentRepository, never()).save(any());
    }

    @Test
    void testFindAppointmentIdsNeedingRemindersAsksForApprovedOnly() {
        when(appointmentRepository.findReminderIds(TOMORROW, false, AppointmentStatus.APPROVED)).thenReturn(List.of(5L));

        assertEquals(List.of(5L), appointmentService.findAppointmentIdsNeedingReminders(TOMORROW));
    }

    @Test
    void testFindDetailsByPublicId() {
        Appointment appt = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(appt);
        when(appointmentRepository.findByPublicId("nope")).thenReturn(null);

        AppointmentDetails details = appointmentService.findDetailsByPublicId("public-1").orElseThrow();

        assertEquals(1L, details.id());
        assertEquals("public-1", details.publicId());
        assertEquals("john@test.com", details.customerEmail());
        assertEquals(AppointmentStatus.PENDING, details.status());
        assertTrue(appointmentService.findDetailsByPublicId("nope").isEmpty());
    }
}
