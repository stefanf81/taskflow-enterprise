package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemResponse;
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

/** {@link AppointmentBookingService}: booking rules, No-Preference resolution, idempotency replay, deadlock retry, busy slots. */
class AppointmentBookingServiceTest extends AppointmentServiceTestSupport {

    @Test
    void testCreateAppointment_NamedBarber_Success_SnapshotsPriceAndPublishesEvents() {
        AppointmentCreationResult result = bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), null);

        assertFalse(result.replayed());
        assertEquals("PENDING", result.appointment().status());
        org.mockito.ArgumentCaptor<Appointment> saved = org.mockito.ArgumentCaptor.forClass(Appointment.class);
        verify(appointmentRepository).save(saved.capture());
        assertEquals(new BigDecimal("25.00"), saved.getValue().getPriceAtBooking());
        assertSame(alex, saved.getValue().getBarber());
        assertSame(haircut, saved.getValue().getService());
        assertEquals(1, eventsOfType(AvailabilityChangedEvent.class).size());
        assertEquals(AppointmentAdminEvent.Type.CREATED, eventsOfType(AppointmentAdminEvent.class).get(0).type());
    }

    @Test
    void testCreateAppointment_NoPreference_ResolvesToConcreteBarber() {
        AppointmentCreationResult result = bookingService.createAppointment(
                request(AppointmentBookingService.NO_PREFERENCE_BARBER, TOMORROW, "10:00"), null);

        assertEquals("Alex the Barber", result.appointment().barberName());
        // the resolution already applied the booking rules: the per-barber re-check is not repeated
        verify(appointmentRepository).findActiveOnDate(TOMORROW);
        verify(appointmentRepository, never()).findActiveForBarberOnDate(any(), any());
    }

    @Test
    void testCreateAppointment_NoPreferenceNoBarberAvailable_Rejected() {
        when(barberRepository.findAllForBooking()).thenReturn(Collections.emptyList());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> bookingService.createAppointment(
                request(AppointmentBookingService.NO_PREFERENCE_BARBER, TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("No barber is available"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
        verify(barberRepository, never()).findAllByOrderByIdAsc();
    }

    /** BKG-1: 10:30 and 10:01 are not grid slots and must never reach the busy/overlap logic. */
    @Test
    void testCreateAppointment_OffGridTimesAreRejected() {
        for (String time : new String[] {"10:30", "10:01", "12:00", "08:00", "17:00", "23:59"}) {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, time), null),
                    "time " + time);
            assertTrue(ex.getMessage().contains("available time slots"), ex.getMessage());
        }
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_NoPreferenceOffGridIsRejectedToo() {
        assertThrows(IllegalArgumentException.class, () -> bookingService.createAppointment(
                request(AppointmentBookingService.NO_PREFERENCE_BARBER, TOMORROW, "10:30"), null));
    }

    @Test
    void testCreateAppointment_ServiceRunningPastClosingTimeIsRejected() {
        ServiceItem longService = new ServiceItem("Luxury", BigDecimal.TEN, 90, "combo", "");
        when(catalogService.findServiceByName("Luxury")).thenReturn(Optional.of(longService));

        // 16:00 + 90 min = 17:30 > 17:00 closing time
        AppointmentCreateRequest tooLate = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123", "Alex the Barber", TOMORROW, "16:00", "Luxury");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(tooLate, null));
        assertTrue(ex.getMessage().contains("closing time"));

        // 15:00 + 90 = 16:30 is fine
        AppointmentCreateRequest fits = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123", "Alex the Barber", TOMORROW, "15:00", "Luxury");
        assertEquals("PENDING", bookingService.createAppointment(fits, null).appointment().status());
    }

    @Test
    void testCreateAppointment_OverlapWithLongerExistingAppointmentIsRejected() {
        Appointment existing = appointment(50, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        existing.setService(new ServiceItem("Luxury", BigDecimal.TEN, 120, "combo", ""));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(existing));
        when(appointmentRepository.findActiveOnDate(TOMORROW)).thenReturn(List.of(existing));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "11:00"), null));
        assertTrue(ex.getMessage().contains("already booked"));
        // sentinel resolution applies the same rule: the only barber is busy
        IllegalArgumentException sentinel = assertThrows(IllegalArgumentException.class, () -> bookingService.createAppointment(
                request(AppointmentBookingService.NO_PREFERENCE_BARBER, TOMORROW, "11:00"), null));
        assertTrue(sentinel.getMessage().contains("No barber is available"), sentinel.getMessage());
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_SameStartAsExistingIsRejected() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(50, AppointmentStatus.PENDING, TOMORROW, "10:00")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("already booked"));
    }

    @Test
    void testCreateAppointment_AdjacentToExistingIsAllowed() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(50, AppointmentStatus.PENDING, TOMORROW, "10:00")));

        assertEquals("PENDING", bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "11:00"), null).appointment().status());
    }

    @Test
    void testCreateAppointment_TimeOffIsRejectedDespiteCachedAvailability() {
        when(barberTimeOffRepository.findBarberIdsOnTimeOff(List.of(7L), TOMORROW)).thenReturn(List.of(7L));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("time off"));
    }

    @Test
    void testCreateAppointment_UnknownBarberAndServiceRejected() {
        when(barberRepository.findByNameForBooking("Ghost Barber")).thenReturn(Optional.empty());
        IllegalArgumentException barber = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Ghost Barber", TOMORROW, "10:00"), null));
        assertTrue(barber.getMessage().contains("Unknown barber"));

        when(catalogService.findServiceByName("Phantom")).thenReturn(Optional.empty());
        IllegalArgumentException service = assertThrows(IllegalArgumentException.class, () ->
                bookingService.createAppointment(new AppointmentCreateRequest(
                        "John Doe", "john@test.com", "123", "Alex the Barber", TOMORROW, "10:00", "Phantom"), null));
        assertTrue(service.getMessage().contains("Unknown service"));
    }

    @Test
    void testCreateAppointment_PastDateAndPastTimeTodayAreRejected() {
        IllegalArgumentException yesterday = assertThrows(IllegalArgumentException.class, () ->
                bookingService.createAppointment(request("Alex the Barber", TODAY.minusDays(1), "10:00"), null));
        assertTrue(yesterday.getMessage().contains("future"));

        // clock is 08:00 today: 09:00 today is still ahead, but "now" itself is not
        assertEquals("PENDING", bookingService.createAppointment(
                request("Alex the Barber", TODAY, "09:00"), null).appointment().status());

        Clock noon = Clock.fixed(Instant.parse("2026-10-12T10:00:00Z"), ZoneOffset.UTC);
        AppointmentBookingService atTen = bookingService(noon);
        assertThrows(IllegalArgumentException.class,
                () -> atTen.createAppointment(request("Alex the Barber", TODAY, "10:00"), null));
        assertThrows(IllegalArgumentException.class,
                () -> atTen.createAppointment(request("Alex the Barber", TODAY, "09:00"), null));
    }

    @Test
    void testCreateAppointment_UsesTheShopTimeZoneNotTheJvmZone() {
        // 00:30 UTC on Oct 12 is already 09:30 in Tokyo. Read as UTC, a 09:00 booking that day would
        // still look like the future; in the shop's own zone it is already past.
        Clock tokyo = Clock.fixed(Instant.parse("2026-10-12T00:30:00Z"), java.time.ZoneId.of("Asia/Tokyo"));
        AppointmentBookingService service = bookingService(tokyo);

        assertEquals("PENDING", service.createAppointment(request("Alex the Barber", TODAY, "10:00"), null)
                .appointment().status());
        assertThrows(IllegalArgumentException.class,
                () -> service.createAppointment(request("Alex the Barber", TODAY, "09:00"), null));
    }

    @Test
    void testCreateAppointment_MaxAdvanceDaysBoundary() {
        // exactly 90 days ahead is allowed, 91 is not
        assertEquals("PENDING", bookingService.createAppointment(
                request("Alex the Barber", TODAY.plusDays(90), "10:00"), null).appointment().status());
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                bookingService.createAppointment(request("Alex the Barber", TODAY.plusDays(91), "10:00"), null));
        assertTrue(ex.getMessage().contains("90 days"));
    }

    @Test
    void testCreateAppointment_PerEmailActiveLimit() {
        when(appointmentRepository.countUpcoming(eq("john@test.com"), eq(TODAY), anyString())).thenReturn(5L);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("maximum"));
        verify(appointmentRepository, never()).save(any(Appointment.class));

        // one below the limit is fine
        when(appointmentRepository.countUpcoming(eq("john@test.com"), eq(TODAY), anyString())).thenReturn(4L);
        assertEquals("PENDING", bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), null).appointment().status());
    }

    @Test
    void testCreateAppointment_IdempotentReplay_SamePayload_ReturnsReplay() {
        Appointment existing = appointment(42, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByIdempotencyKey("idem-1")).thenReturn(existing);

        AppointmentCreationResult result = bookingService.createAppointment(
                new AppointmentCreateRequest("John Doe", "JOHN@test.com", "999", "Alex the Barber", TOMORROW, "10:00", "Haircut"),
                "idem-1");

        assertTrue(result.replayed());
        assertEquals(42L, result.appointment().id());
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    /** BKG-5: a late replay of the original create request returns the cancelled row, it does not rebook. */
    @Test
    void testCreateAppointment_IdempotentReplayOfCancelledBooking_ReturnsTheCancelledRowWithoutRebooking() {
        Appointment cancelled = appointment(42, AppointmentStatus.CANCELLED, TOMORROW, "10:00");
        when(appointmentRepository.findByIdempotencyKey("idem-1")).thenReturn(cancelled);

        AppointmentCreationResult result = bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), "idem-1");

        assertTrue(result.replayed());
        assertEquals("CANCELLED", result.appointment().status());
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_IdempotentReplay_EmailOrPayloadMismatch_ThrowsConflict() {
        Appointment existing = appointment(42, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByIdempotencyKey("idem-1")).thenReturn(existing);

        assertThrows(IdempotencyConflictException.class, () -> bookingService.createAppointment(
                new AppointmentCreateRequest("Attacker", "attacker@test.com", "999", "Alex the Barber", TOMORROW, "10:00", "Haircut"),
                "idem-1"));
        assertThrows(IdempotencyConflictException.class, () -> bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "11:00"), "idem-1"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    /**
     * A same-key request commits between this request's idempotency pre-check and its
     * availability read; the loser must get a verified replay, not a 400.
     */
    @Test
    void testCreateAppointment_SameKeyCommittedBeforeAvailabilityRead_ReturnsReplay() {
        Appointment winner = appointment(42, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByIdempotencyKey("race-key")).thenReturn(null, winner);
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(winner));

        AppointmentCreationResult result = bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), "race-key");

        assertTrue(result.replayed());
        assertEquals(42L, result.appointment().id());
        verify(appointmentRepository, times(2)).findByIdempotencyKey("race-key");
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_KeyedRequestSlotTakenByOtherBooking_Rejected() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(43, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        when(appointmentRepository.findByIdempotencyKey("fresh-key")).thenReturn(null);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), "fresh-key"));
        assertTrue(ex.getMessage().contains("already booked"));
        verify(appointmentRepository, times(2)).findByIdempotencyKey("fresh-key");
    }

    @Test
    void testCreateAppointment_ExclusionViolationIsASlotCollision() {
        when(appointmentRepository.save(any(Appointment.class))).thenThrow(
                new org.springframework.dao.DataIntegrityViolationException("overlap",
                        new java.sql.SQLException("conflicting key value violates exclusion constraint", "23P01")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("just booked"), ex.getMessage());
    }

    /** PostgreSQL deadlock between two overlapping inserts: the victim retries once and gets the 400. */
    @Test
    void testCreateAppointment_DeadlockVictimIsRetriedAndReportedAsASlotCollision() {
        when(appointmentRepository.save(any(Appointment.class)))
                .thenThrow(new org.springframework.dao.CannotAcquireLockException("deadlock",
                        new java.sql.SQLException("deadlock detected", "40P01")))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("overlap",
                        new java.sql.SQLException("conflicting key value violates exclusion constraint", "23P01")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("just booked"), ex.getMessage());
        verify(appointmentRepository, times(2)).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_DeadlockRetryCanSucceed() {
        when(appointmentRepository.save(any(Appointment.class)))
                .thenThrow(new org.springframework.dao.CannotAcquireLockException("deadlock",
                        new java.sql.SQLException("deadlock detected", "40P01")))
                .thenAnswer(inv -> {
                    Appointment saved = inv.getArgument(0);
                    saved.setId(101L);
                    return saved;
                });

        assertEquals(101L, bookingService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), null).appointment().id());
        verify(appointmentRepository, times(2)).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_LockTimeoutIsNotRetried() {
        org.springframework.dao.CannotAcquireLockException timeout =
                new org.springframework.dao.CannotAcquireLockException("lock timeout",
                        new java.sql.SQLException("canceling statement due to lock timeout", "55P03"));
        when(appointmentRepository.save(any(Appointment.class))).thenThrow(timeout);

        assertSame(timeout, assertThrows(org.springframework.dao.CannotAcquireLockException.class,
                () -> bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null)));
        verify(appointmentRepository, times(1)).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_StoresTheValidatedEndTime() {
        bookingService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null);

        org.mockito.ArgumentCaptor<Appointment> saved = org.mockito.ArgumentCaptor.forClass(Appointment.class);
        verify(appointmentRepository).save(saved.capture());
        assertEquals(LocalTime.of(10, 30), saved.getValue().getBookingEndTime()); // 30-minute haircut
    }

    @Test
    void testGetBusySlots_DelegatesAndPropagatesValidationErrors() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        assertEquals(List.of("10:00"), bookingService.getBusySlots("Alex the Barber", TOMORROW.toString()));

        assertThrows(IllegalArgumentException.class, () -> bookingService.getBusySlots("Alex the Barber", "invalid-date"));
        when(barberRepository.findByName("Ghost")).thenReturn(Optional.empty());
        assertThrows(IllegalArgumentException.class, () -> bookingService.getBusySlots("Ghost", TOMORROW.toString()));
    }

    /** The service's length comes from the cached catalog list, never from a per-request lookup. */
    @Test
    void testGetBusySlots_ServiceLengthComesFromTheCachedCatalog() {
        when(catalogService.getAllServices()).thenReturn(List.of(
                new ServiceItemResponse(1L, "Haircut", new BigDecimal("25.00"), 30, "hair", null),
                new ServiceItemResponse(2L, "Luxury", BigDecimal.TEN, 120, "combo", null)));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "11:00")));

        assertEquals(List.of("11:00"),
                bookingService.getBusySlots("Alex the Barber", TOMORROW.toString(), "Haircut"));
        // 120 minutes from 10:00 run into the 11:00 booking, from 16:00 past the 17:00 closing time
        assertEquals(List.of("10:00", "11:00", "16:00"),
                bookingService.getBusySlots("Alex the Barber", TOMORROW.toString(), " Luxury "));
        IllegalArgumentException unknown = assertThrows(IllegalArgumentException.class,
                () -> bookingService.getBusySlots("Alex the Barber", TOMORROW.toString(), "Phantom"));
        assertTrue(unknown.getMessage().contains("Unknown service"));
        verify(catalogService, never()).findServiceByName(any());
    }

    @Test
    void testGetBusySlots_UnbookableDatesAreFullyBusyWithoutPerDateQueries() {
        LocalDate lastBookable = TODAY.plusDays(BookingProperties.defaults().maxAdvanceDays());
        for (String date : List.of(TODAY.minusDays(1).toString(), "0001-01-01", "9999-12-31",
                lastBookable.plusDays(1).toString())) {
            assertEquals(BusySlotsService.ALL_SLOTS, bookingService.getBusySlots("Alex the Barber", date), date);
            assertEquals(BusySlotsService.ALL_SLOTS,
                    bookingService.getBusySlots(AppointmentBookingService.NO_PREFERENCE_BARBER, date, "Haircut"), date);
        }
        verify(appointmentRepository, never()).findActiveForBarberOnDate(any(), any());
        verify(appointmentRepository, never()).findActiveOnDate(any());

        when(barberRepository.findByName("Ghost")).thenReturn(Optional.empty());
        assertThrows(IllegalArgumentException.class,
                () -> bookingService.getBusySlots("Ghost", "0001-01-01"), "an unknown barber stays a 400");

        // today and the last bookable day are still computed
        bookingService.getBusySlots("Alex the Barber", TODAY.toString());
        bookingService.getBusySlots("Alex the Barber", lastBookable.toString());
        verify(appointmentRepository).findActiveForBarberOnDate("Alex the Barber", TODAY);
        verify(appointmentRepository).findActiveForBarberOnDate("Alex the Barber", lastBookable);
    }
}
