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

/** {@link AppointmentLifecycleService}: admin status transitions (BKG-3) and the soft cancel by admin, guest and customer (BKG-5). */
class AppointmentLifecycleServiceTest extends AppointmentServiceTestSupport {

    @Test
    void testUpdateStatus_PendingToApproved_Success() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(pending));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(pending));

        AppointmentResponse response = lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED"));

        assertEquals("APPROVED", response.status());
        verify(appointmentRepository).save(pending);
        assertEquals(1, eventsOfType(AppointmentStatusChangedEvent.class).size());
        assertEquals(1, eventsOfType(AvailabilityChangedEvent.class).size());
        assertEquals(AppointmentAdminEvent.Type.UPDATED, eventsOfType(AppointmentAdminEvent.class).get(0).type());
    }

    @Test
    void testUpdateStatus_ApprovedToDenied_And_PendingToDenied() {
        Appointment approved = appointment(1, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        Appointment pending = appointment(2, AppointmentStatus.PENDING, TODAY.minusDays(3), "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(approved));
        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(pending));

        assertEquals("DENIED", lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("DENIED")).status());
        // denying an overdue pending booking must stay possible (no availability check on deny)
        assertEquals("DENIED", lifecycleService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("DENIED")).status());
    }

    /** BKG-3: same-status requests are a no-op: no write, no event, hence no e-mail. */
    @Test
    void testUpdateStatus_SameStatusIsANoOp() {
        Appointment approved = appointment(1, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(approved));

        AppointmentResponse response = lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED"));

        assertEquals("APPROVED", response.status());
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty(), "no event may be published for a no-op: " + events);
    }

    @Test
    void testUpdateStatus_AnythingOnCancelledIsAConflict() {
        Appointment cancelled = appointment(1, AppointmentStatus.CANCELLED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(cancelled));

        assertThrows(InvalidStatusTransitionException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertThrows(InvalidStatusTransitionException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("DENIED")));
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty());
    }

    @Test
    void testUpdateStatus_BackToPendingOrToCancelledIsAConflict() {
        for (AppointmentStatus from : List.of(AppointmentStatus.APPROVED, AppointmentStatus.DENIED)) {
            when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment(1, from, TOMORROW, "10:00")));
            for (String target : List.of("PENDING", "CANCELLED")) {
                assertThrows(InvalidStatusTransitionException.class,
                        () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest(target)),
                        from + " -> " + target);
            }
        }
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty());
    }

    @Test
    void testUpdateStatus_DeniedToApproved_ReChecksAvailability() {
        Appointment denied = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(denied));

        // slot still free: re-approval works
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of());
        assertEquals("APPROVED", lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")).status());
    }

    /** V35: an overlap only the PostgreSQL exclusion constraint saw (23P01) at approval is the same 409. */
    @Test
    void testUpdateStatus_ApproveHittingTheExclusionConstraintIsAConflict() {
        Appointment denied = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(denied));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of());
        org.mockito.Mockito.doThrow(new org.springframework.dao.DataIntegrityViolationException("overlap",
                        new java.sql.SQLException("conflicting key value violates exclusion constraint", "23P01")))
                .when(appointmentRepository).flush();

        ConflictException ex = assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("already booked"));
        assertTrue(eventsOfType(AppointmentStatusChangedEvent.class).isEmpty());
    }

    @Test
    void testUpdateStatus_OtherIntegrityViolationsOnApprovalPropagate() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(pending));
        org.springframework.dao.DataIntegrityViolationException notNull =
                new org.springframework.dao.DataIntegrityViolationException("not null",
                        new java.sql.SQLException("null value", "23502"));
        org.mockito.Mockito.doThrow(notNull).when(appointmentRepository).flush();

        assertSame(notNull, assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED"))));
    }

    /** BKG-3: the slot of a DENIED booking was re-booked meanwhile -> 409, status untouched. */
    @Test
    void testUpdateStatus_DeniedToApproved_SlotRebookedMeanwhile_IsAConflict() {
        Appointment denied = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        Appointment rebooked = appointment(2, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(denied));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(rebooked));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("already booked"));
        assertEquals(AppointmentStatus.DENIED, denied.getStatusEnum());
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty());
    }

    @Test
    void testUpdateStatus_ApproveRefusesRowsWithoutAConcreteBarber() {
        Appointment sentinel = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        sentinel.setBarberName(AppointmentBookingService.NO_PREFERENCE_BARBER);
        sentinel.setBarber(null);
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(sentinel));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("no assigned barber"));

        // a null FK on its own is enough
        Appointment noFk = appointment(2, AppointmentStatus.PENDING, TOMORROW, "11:00");
        noFk.setBarber(null);
        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(noFk));
        assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("APPROVED")));
        // ...but such a row can still be denied
        assertEquals("DENIED", lifecycleService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("DENIED")).status());
    }

    @Test
    void testUpdateStatus_ApproveRefusesPastAppointments() {
        Appointment past = appointment(1, AppointmentStatus.PENDING, TODAY.minusDays(1), "10:00");
        Appointment earlierToday = appointment(2, AppointmentStatus.PENDING, TODAY, "07:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(past));
        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(earlierToday));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("past"));
        assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("APPROVED")));
    }

    @Test
    void testUpdateStatus_ApproveRefusesWhenBarberNowOnLeave() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(pending));
        when(barberTimeOffRepository.findBarberIdsOnTimeOff(List.of(7L), TOMORROW)).thenReturn(List.of(7L));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("time off"));
    }

    @Test
    void testUpdateStatus_NotFoundAndUnknownTarget() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class,
                () -> lifecycleService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));

        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(appointment(2, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        assertThrows(IllegalArgumentException.class,
                () -> lifecycleService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("OTHER")));
        // PENDING / CANCELLED are not valid targets of this endpoint
        assertThrows(InvalidStatusTransitionException.class,
                () -> lifecycleService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("CANCELLED")));
    }

    @Test
    void testPublicCancel_SoftCancelsAndPublishesDedicatedEvent() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(pending);

        lifecycleService.publicCancelAppointment("public-1", " JOHN@test.com ");

        assertEquals(AppointmentStatus.CANCELLED, pending.getStatusEnum());
        verify(appointmentRepository).save(pending);
        verify(appointmentRepository, never()).delete(any(Appointment.class));
        AppointmentCancelledEvent event = eventsOfType(AppointmentCancelledEvent.class).get(0);
        assertEquals("public-1", event.appointment().publicId());
        assertEquals(AppointmentStatus.CANCELLED, event.appointment().status());
        assertEquals(AppointmentCancelledEvent.CancelledBy.GUEST, event.cancelledBy());
        assertTrue(eventsOfType(AppointmentStatusChangedEvent.class).isEmpty(),
                "cancel must not publish the status-change event with the stale status");
        assertEquals(1, eventsOfType(AvailabilityChangedEvent.class).size());
        assertEquals(1, eventsOfType(AppointmentAdminEvent.class).size());
    }

    @Test
    void testPublicCancel_AlreadyCancelledIsIdempotent() {
        Appointment cancelled = appointment(1, AppointmentStatus.CANCELLED, TOMORROW, "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(cancelled);

        lifecycleService.publicCancelAppointment("public-1", "john@test.com");

        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty());
    }

    @Test
    void testPublicCancel_DeniedIsRejected_PastIsRejected_WrongEmailIsRejected_UnknownIs404() {
        Appointment denied = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        Appointment past = appointment(2, AppointmentStatus.APPROVED, TODAY, "07:00");
        Appointment ok = appointment(3, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(denied);
        when(appointmentRepository.findByPublicId("public-2")).thenReturn(past);
        when(appointmentRepository.findByPublicId("public-3")).thenReturn(ok);
        when(appointmentRepository.findByPublicId("nope")).thenReturn(null);

        assertTrue(assertThrows(IllegalArgumentException.class,
                () -> lifecycleService.publicCancelAppointment("public-1", "john@test.com")).getMessage().contains("declined"));
        assertTrue(assertThrows(IllegalArgumentException.class,
                () -> lifecycleService.publicCancelAppointment("public-2", "john@test.com")).getMessage().contains("already started"));
        assertThrows(IllegalArgumentException.class,
                () -> lifecycleService.publicCancelAppointment("public-3", "wrong@test.com"));
        assertThrows(ResourceNotFoundException.class,
                () -> lifecycleService.publicCancelAppointment("nope", "john@test.com"));
        assertEquals(AppointmentStatus.APPROVED, ok.getStatusEnum());
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCustomerCancel_OwnershipPastAndEvent() {
        Appointment mine = appointment(1, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        Appointment past = appointment(2, AppointmentStatus.APPROVED, TODAY.minusDays(1), "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(mine);
        when(appointmentRepository.findByPublicId("public-2")).thenReturn(past);

        assertThrows(ResourceNotFoundException.class,
                () -> lifecycleService.cancelMyAppointment("public-1", "someone-else@test.com"));
        assertThrows(IllegalArgumentException.class,
                () -> lifecycleService.cancelMyAppointment("public-2", "john@test.com"));

        lifecycleService.cancelMyAppointment("public-1", "John@Test.com");
        assertEquals(AppointmentStatus.CANCELLED, mine.getStatusEnum());
        assertEquals(AppointmentCancelledEvent.CancelledBy.CUSTOMER,
                eventsOfType(AppointmentCancelledEvent.class).get(0).cancelledBy());
    }

    @Test
    void testAdminDelete_SoftCancelsEvenPastBookings_ButNotDeniedOnes() {
        Appointment past = appointment(1, AppointmentStatus.APPROVED, TODAY.minusDays(5), "10:00");
        Appointment denied = appointment(2, AppointmentStatus.DENIED, TOMORROW, "10:00");
        Appointment cancelled = appointment(3, AppointmentStatus.CANCELLED, TOMORROW, "11:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(past));
        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(denied));
        when(appointmentRepository.findById(3L)).thenReturn(Optional.of(cancelled));

        lifecycleService.deleteAppointment(1L);
        assertEquals(AppointmentStatus.CANCELLED, past.getStatusEnum());
        assertEquals(AppointmentCancelledEvent.CancelledBy.ADMIN,
                eventsOfType(AppointmentCancelledEvent.class).get(0).cancelledBy());
        verify(appointmentRepository, never()).delete(any(Appointment.class));
        verify(appointmentRepository, never()).deleteById(any());

        assertThrows(IllegalArgumentException.class, () -> lifecycleService.deleteAppointment(2L));
        events.clear();
        lifecycleService.deleteAppointment(3L); // idempotent
        assertTrue(events.isEmpty());

        when(appointmentRepository.findById(9L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> lifecycleService.deleteAppointment(9L));
    }
}
