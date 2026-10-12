package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.IdempotencyConflictException;
import com.example.taskflow.core.InvalidStatusTransitionException;
import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AppointmentServiceImplTest {

    /** Monday 2026-10-12, 08:00 shop time (UTC). */
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-12T08:00:00Z"), ZoneOffset.UTC);
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 12);
    private static final LocalDate TOMORROW = TODAY.plusDays(1);

    @Mock
    private AppointmentRepository appointmentRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    @Mock
    private AppointmentStatsService statsService;

    @Mock
    private io.micrometer.tracing.Tracer tracer;

    @Mock
    private BarberRepository barberRepository;

    @Mock
    private com.example.taskflow.catalog.CatalogService catalogService;

    @Mock
    private BarberScheduleRepository barberScheduleRepository;

    @Mock
    private BarberTimeOffRepository barberTimeOffRepository;

    @Mock
    private org.springframework.transaction.PlatformTransactionManager transactionManager;

    private BusySlotsService busySlotsService;

    private AppointmentServiceImpl appointmentService;

    private Barber alex;
    private ServiceItem haircut;
    private final List<Object> events = new ArrayList<>();

    @BeforeEach
    void setUp() {
        busySlotsService = new BusySlotsService(barberRepository, barberScheduleRepository, barberTimeOffRepository, appointmentRepository);
        appointmentService = new AppointmentServiceImpl(
                appointmentRepository, eventPublisher, statsService, tracer,
                busySlotsService, barberRepository,
                catalogService, CLOCK, BookingProperties.defaults(), transactionManager
        );

        alex = new Barber();
        alex.setId(7L);
        alex.setName("Alex the Barber");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(LocalTime.of(9, 0));
        schedule.setEndTime(LocalTime.of(17, 0));
        schedule.setBarber(alex);
        haircut = new ServiceItem("Haircut", new BigDecimal("25.00"), 30, "hair", "");

        lenient().when(barberRepository.findByName("Alex the Barber")).thenReturn(Optional.of(alex));
        lenient().when(barberRepository.findAllByOrderByIdAsc()).thenReturn(List.of(alex));
        lenient().when(barberScheduleRepository.findForBarbersOnDay(any(), any())).thenReturn(List.of(schedule));
        lenient().when(barberTimeOffRepository.findBarberIdsOnTimeOff(any(), any())).thenReturn(Collections.emptyList());
        lenient().when(catalogService.findServiceByName("Haircut")).thenReturn(Optional.of(haircut));
        lenient().when(appointmentRepository.save(any(Appointment.class))).thenAnswer(inv -> {
            Appointment saved = inv.getArgument(0);
            if (saved.getId() == null) {
                saved.setId(100L);
            }
            return saved;
        });
        lenient().doAnswer(inv -> events.add(inv.getArgument(0))).when(eventPublisher).publishEvent(any(Object.class));
        lenient().doAnswer(inv -> events.add(inv.getArgument(0))).when(eventPublisher).publishEvent(any(ApplicationEvent.class));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private AppointmentCreateRequest request(String barber, LocalDate date, String time) {
        return new AppointmentCreateRequest("John Doe", "john@test.com", "123", barber, date, time, "Haircut");
    }

    private Appointment appointment(long id, AppointmentStatus status, LocalDate date, String time) {
        Appointment appointment = new Appointment("John Doe", "john@test.com", "123",
                "Alex the Barber", date, time, "Haircut");
        appointment.setId(id);
        appointment.setPublicId("public-" + id);
        appointment.setBarber(alex);
        appointment.setService(haircut);
        appointment.setStatus(status);
        return appointment;
    }

    private <T> List<T> eventsOfType(Class<T> type) {
        return events.stream().filter(type::isInstance).map(type::cast).toList();
    }

    // ── admin listing ────────────────────────────────────────────────────────

    @Test
    void testGetAllAppointments_NoFilters() {
        Page<Appointment> page = new PageImpl<>(List.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        when(appointmentRepository.findAll(any(Pageable.class))).thenReturn(page);
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(1L, 1L, 0L, 0L, 0L, 0, 0.0));

        AppointmentDashboardResponse response = appointmentService.getAllAppointments(null, null, 0, 10);

        assertEquals(1, response.page().getTotalElements());
        assertEquals("John Doe", response.page().getContent().get(0).customerName());
        assertEquals(1L, response.stats().total());
    }

    @Test
    void testGetAllAppointments_BlankFiltersMeanNoFilter() {
        when(appointmentRepository.findAll(any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(4L, 2L, 1L, 1L, 0L, 0, 25.0));

        AppointmentDashboardResponse response = appointmentService.getAllAppointments("", "  ", 0, 10);

        assertEquals(25, response.stats().progress());
        verify(appointmentRepository, never()).findAll(any(Specification.class), any(Pageable.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void testGetAllAppointments_StatusSearchAndOverdueUseASpecification() {
        when(appointmentRepository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));
        when(statsService.getStatsCached(appointmentRepository)).thenReturn(new AppointmentStats(0L, 0L, 0L, 0L, 0L, 0, 0.0));

        appointmentService.getAllAppointments("PENDING", "John", 0, 10);
        appointmentService.getAllAppointments("cancelled", null, 0, 10);
        appointmentService.getAllAppointments(null, "john@test.com", 0, 10);
        appointmentService.getAllAppointments("OVERDUE", "john", 0, 10);

        verify(appointmentRepository, times(4)).findAll(any(Specification.class), any(Pageable.class));
        verify(appointmentRepository, never()).findAll(any(Pageable.class));
    }

    @Test
    void testGetAllAppointments_UnknownStatusIsRejected() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.getAllAppointments("BOGUS", null, 0, 10));
        assertTrue(ex.getMessage().contains("Unknown status"));
        verifyNoInteractions(statsService);
    }

    @Test
    void testGetAppointmentById() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        assertEquals(1L, appointmentService.getAppointmentById(1L).id());
        when(appointmentRepository.findById(2L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> appointmentService.getAppointmentById(2L));
    }

    // ── creation: BKG-1 grid / schedule / duration / overlap ────────────────

    @Test
    void testCreateAppointment_NamedBarber_Success_SnapshotsPriceAndPublishesEvents() {
        AppointmentCreationResult result = appointmentService.createAppointment(
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
        AppointmentCreationResult result = appointmentService.createAppointment(
                request(AppointmentServiceImpl.NO_PREFERENCE_BARBER, TOMORROW, "10:00"), null);

        assertEquals("Alex the Barber", result.appointment().barberName());
    }

    @Test
    void testCreateAppointment_NoPreferenceNoBarberAvailable_Rejected() {
        when(barberRepository.findAllByOrderByIdAsc()).thenReturn(Collections.emptyList());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> appointmentService.createAppointment(
                request(AppointmentServiceImpl.NO_PREFERENCE_BARBER, TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("No barber is available"));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    /** BKG-1: 10:30 and 10:01 are not grid slots and must never reach the busy/overlap logic. */
    @Test
    void testCreateAppointment_OffGridTimesAreRejected() {
        for (String time : new String[] {"10:30", "10:01", "12:00", "08:00", "17:00", "23:59"}) {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, time), null),
                    "time " + time);
            assertTrue(ex.getMessage().contains("available time slots"), ex.getMessage());
        }
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_NoPreferenceOffGridIsRejectedToo() {
        assertThrows(IllegalArgumentException.class, () -> appointmentService.createAppointment(
                request(AppointmentServiceImpl.NO_PREFERENCE_BARBER, TOMORROW, "10:30"), null));
    }

    @Test
    void testCreateAppointment_ServiceRunningPastClosingTimeIsRejected() {
        ServiceItem longService = new ServiceItem("Luxury", BigDecimal.TEN, 90, "combo", "");
        when(catalogService.findServiceByName("Luxury")).thenReturn(Optional.of(longService));

        // 16:00 + 90 min = 17:30 > 17:00 closing time
        AppointmentCreateRequest tooLate = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123", "Alex the Barber", TOMORROW, "16:00", "Luxury");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(tooLate, null));
        assertTrue(ex.getMessage().contains("closing time"));

        // 15:00 + 90 = 16:30 is fine
        AppointmentCreateRequest fits = new AppointmentCreateRequest(
                "John Doe", "john@test.com", "123", "Alex the Barber", TOMORROW, "15:00", "Luxury");
        assertEquals("PENDING", appointmentService.createAppointment(fits, null).appointment().status());
    }

    @Test
    void testCreateAppointment_OverlapWithLongerExistingAppointmentIsRejected() {
        Appointment existing = appointment(50, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        existing.setService(new ServiceItem("Luxury", BigDecimal.TEN, 120, "combo", ""));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(existing));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "11:00"), null));
        assertTrue(ex.getMessage().contains("already booked"));
        // sentinel resolution applies the same rule: the only barber is busy
        assertThrows(IllegalArgumentException.class, () -> appointmentService.createAppointment(
                request(AppointmentServiceImpl.NO_PREFERENCE_BARBER, TOMORROW, "11:00"), null));
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_SameStartAsExistingIsRejected() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(50, AppointmentStatus.PENDING, TOMORROW, "10:00")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("already booked"));
    }

    @Test
    void testCreateAppointment_AdjacentToExistingIsAllowed() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(50, AppointmentStatus.PENDING, TOMORROW, "10:00")));

        assertEquals("PENDING", appointmentService.createAppointment(
                request("Alex the Barber", TOMORROW, "11:00"), null).appointment().status());
    }

    @Test
    void testCreateAppointment_TimeOffIsRejectedDespiteCachedAvailability() {
        when(barberTimeOffRepository.findBarberIdsOnTimeOff(List.of(7L), TOMORROW)).thenReturn(List.of(7L));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("time off"));
    }

    @Test
    void testCreateAppointment_UnknownBarberAndServiceRejected() {
        when(barberRepository.findByName("Ghost Barber")).thenReturn(Optional.empty());
        IllegalArgumentException barber = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("Ghost Barber", TOMORROW, "10:00"), null));
        assertTrue(barber.getMessage().contains("Unknown barber"));

        when(catalogService.findServiceByName("Phantom")).thenReturn(Optional.empty());
        IllegalArgumentException service = assertThrows(IllegalArgumentException.class, () ->
                appointmentService.createAppointment(new AppointmentCreateRequest(
                        "John Doe", "john@test.com", "123", "Alex the Barber", TOMORROW, "10:00", "Phantom"), null));
        assertTrue(service.getMessage().contains("Unknown service"));
    }

    // ── creation: BKG-2 date window and per-email limit ──────────────────────

    @Test
    void testCreateAppointment_PastDateAndPastTimeTodayAreRejected() {
        IllegalArgumentException yesterday = assertThrows(IllegalArgumentException.class, () ->
                appointmentService.createAppointment(request("Alex the Barber", TODAY.minusDays(1), "10:00"), null));
        assertTrue(yesterday.getMessage().contains("future"));

        // clock is 08:00 today: 09:00 today is still ahead, but "now" itself is not
        assertEquals("PENDING", appointmentService.createAppointment(
                request("Alex the Barber", TODAY, "09:00"), null).appointment().status());

        Clock noon = Clock.fixed(Instant.parse("2026-10-12T10:00:00Z"), ZoneOffset.UTC);
        AppointmentServiceImpl atTen = new AppointmentServiceImpl(
                appointmentRepository, eventPublisher, statsService, tracer, busySlotsService, barberRepository,
                catalogService, noon,
                BookingProperties.defaults(), transactionManager);
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
        AppointmentServiceImpl service = new AppointmentServiceImpl(
                appointmentRepository, eventPublisher, statsService, tracer, busySlotsService, barberRepository,
                catalogService, tokyo,
                BookingProperties.defaults(), transactionManager);

        assertEquals("PENDING", service.createAppointment(request("Alex the Barber", TODAY, "10:00"), null)
                .appointment().status());
        assertThrows(IllegalArgumentException.class,
                () -> service.createAppointment(request("Alex the Barber", TODAY, "09:00"), null));
    }

    @Test
    void testCreateAppointment_MaxAdvanceDaysBoundary() {
        // exactly 90 days ahead is allowed, 91 is not
        assertEquals("PENDING", appointmentService.createAppointment(
                request("Alex the Barber", TODAY.plusDays(90), "10:00"), null).appointment().status());
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                appointmentService.createAppointment(request("Alex the Barber", TODAY.plusDays(91), "10:00"), null));
        assertTrue(ex.getMessage().contains("90 days"));
    }

    @Test
    void testCreateAppointment_PerEmailActiveLimit() {
        when(appointmentRepository.countUpcoming(eq("john@test.com"), eq(TODAY), anyString())).thenReturn(5L);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("maximum"));
        verify(appointmentRepository, never()).save(any(Appointment.class));

        // one below the limit is fine
        when(appointmentRepository.countUpcoming(eq("john@test.com"), eq(TODAY), anyString())).thenReturn(4L);
        assertEquals("PENDING", appointmentService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), null).appointment().status());
    }

    // ── idempotency ──────────────────────────────────────────────────────────

    @Test
    void testCreateAppointment_IdempotentReplay_SamePayload_ReturnsReplay() {
        Appointment existing = appointment(42, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByIdempotencyKey("idem-1")).thenReturn(existing);

        AppointmentCreationResult result = appointmentService.createAppointment(
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

        AppointmentCreationResult result = appointmentService.createAppointment(
                request("Alex the Barber", TOMORROW, "10:00"), "idem-1");

        assertTrue(result.replayed());
        assertEquals("CANCELLED", result.appointment().status());
        verify(appointmentRepository, never()).save(any(Appointment.class));
    }

    @Test
    void testCreateAppointment_IdempotentReplay_EmailOrPayloadMismatch_ThrowsConflict() {
        Appointment existing = appointment(42, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByIdempotencyKey("idem-1")).thenReturn(existing);

        assertThrows(IdempotencyConflictException.class, () -> appointmentService.createAppointment(
                new AppointmentCreateRequest("Attacker", "attacker@test.com", "999", "Alex the Barber", TOMORROW, "10:00", "Haircut"),
                "idem-1"));
        assertThrows(IdempotencyConflictException.class, () -> appointmentService.createAppointment(
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

        AppointmentCreationResult result = appointmentService.createAppointment(
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
                () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), "fresh-key"));
        assertTrue(ex.getMessage().contains("already booked"));
        verify(appointmentRepository, times(2)).findByIdempotencyKey("fresh-key");
    }

    // ── status updates: BKG-3 ────────────────────────────────────────────────

    @Test
    void testUpdateStatus_PendingToApproved_Success() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(pending));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(pending));

        AppointmentResponse response = appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED"));

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

        assertEquals("DENIED", appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("DENIED")).status());
        // denying an overdue pending booking must stay possible (no availability check on deny)
        assertEquals("DENIED", appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("DENIED")).status());
    }

    /** BKG-3: same-status requests are a no-op: no write, no event, hence no e-mail. */
    @Test
    void testUpdateStatus_SameStatusIsANoOp() {
        Appointment approved = appointment(1, AppointmentStatus.APPROVED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(approved));

        AppointmentResponse response = appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED"));

        assertEquals("APPROVED", response.status());
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty(), "no event may be published for a no-op: " + events);
    }

    @Test
    void testUpdateStatus_AnythingOnCancelledIsAConflict() {
        Appointment cancelled = appointment(1, AppointmentStatus.CANCELLED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(cancelled));

        assertThrows(InvalidStatusTransitionException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertThrows(InvalidStatusTransitionException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("DENIED")));
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty());
    }

    @Test
    void testUpdateStatus_DeniedToApproved_ReChecksAvailability() {
        Appointment denied = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(denied));

        // slot still free: re-approval works
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of());
        assertEquals("APPROVED", appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")).status());
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
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
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
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED"))));
    }

    @Test
    void testCreateAppointment_ExclusionViolationIsASlotCollision() {
        when(appointmentRepository.save(any(Appointment.class))).thenThrow(
                new org.springframework.dao.DataIntegrityViolationException("overlap",
                        new java.sql.SQLException("conflicting key value violates exclusion constraint", "23P01")));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null));
        assertTrue(ex.getMessage().contains("just booked"), ex.getMessage());
    }

    @Test
    void testCreateAppointment_StoresTheValidatedEndTime() {
        appointmentService.createAppointment(request("Alex the Barber", TOMORROW, "10:00"), null);

        org.mockito.ArgumentCaptor<Appointment> saved = org.mockito.ArgumentCaptor.forClass(Appointment.class);
        verify(appointmentRepository).save(saved.capture());
        assertEquals(LocalTime.of(10, 30), saved.getValue().getBookingEndTime()); // 30-minute haircut
    }

    @Test
    void testIsSlotConstraintViolationRecognisesUniqueAndExclusionViolationsOnly() {
        assertTrue(AppointmentServiceImpl.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("dup", "23505"))));
        assertTrue(AppointmentServiceImpl.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("overlap", "23P01"))));
        assertFalse(AppointmentServiceImpl.isSlotConstraintViolation(
                new RuntimeException(new java.sql.SQLException("fk", "23503"))));
        assertFalse(AppointmentServiceImpl.isSlotConstraintViolation(new RuntimeException("no sql state")));
    }

    /** BKG-3: the slot of a DENIED booking was re-booked meanwhile -> 409, status untouched. */
    @Test
    void testUpdateStatus_DeniedToApproved_SlotRebookedMeanwhile_IsAConflict() {
        Appointment denied = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        Appointment rebooked = appointment(2, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(denied));
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW)).thenReturn(List.of(rebooked));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("already booked"));
        assertEquals(AppointmentStatus.DENIED, denied.getStatusEnum());
        verify(appointmentRepository, never()).save(any(Appointment.class));
        assertTrue(events.isEmpty());
    }

    @Test
    void testUpdateStatus_ApproveRefusesRowsWithoutAConcreteBarber() {
        Appointment sentinel = appointment(1, AppointmentStatus.DENIED, TOMORROW, "10:00");
        sentinel.setBarberName(AppointmentServiceImpl.NO_PREFERENCE_BARBER);
        sentinel.setBarber(null);
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(sentinel));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("no assigned barber"));

        // a null FK on its own is enough
        Appointment noFk = appointment(2, AppointmentStatus.PENDING, TOMORROW, "11:00");
        noFk.setBarber(null);
        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(noFk));
        assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("APPROVED")));
        // ...but such a row can still be denied
        assertEquals("DENIED", appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("DENIED")).status());
    }

    @Test
    void testUpdateStatus_ApproveRefusesPastAppointments() {
        Appointment past = appointment(1, AppointmentStatus.PENDING, TODAY.minusDays(1), "10:00");
        Appointment earlierToday = appointment(2, AppointmentStatus.PENDING, TODAY, "07:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(past));
        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(earlierToday));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("past"));
        assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("APPROVED")));
    }

    @Test
    void testUpdateStatus_ApproveRefusesWhenBarberNowOnLeave() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findById(1L)).thenReturn(Optional.of(pending));
        when(barberTimeOffRepository.findBarberIdsOnTimeOff(List.of(7L), TOMORROW)).thenReturn(List.of(7L));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("time off"));
    }

    @Test
    void testUpdateStatus_NotFoundAndUnknownTarget() {
        when(appointmentRepository.findById(1L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class,
                () -> appointmentService.updateAppointmentStatus(1L, new AppointmentUpdateRequest("APPROVED")));

        when(appointmentRepository.findById(2L)).thenReturn(Optional.of(appointment(2, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        assertThrows(IllegalArgumentException.class,
                () -> appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("OTHER")));
        // PENDING / CANCELLED are not valid targets of this endpoint
        assertThrows(InvalidStatusTransitionException.class,
                () -> appointmentService.updateAppointmentStatus(2L, new AppointmentUpdateRequest("CANCELLED")));
    }

    // ── cancel: BKG-5 ────────────────────────────────────────────────────────

    @Test
    void testPublicCancel_SoftCancelsAndPublishesDedicatedEvent() {
        Appointment pending = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(pending);

        appointmentService.publicCancelAppointment("public-1", " JOHN@test.com ");

        assertEquals(AppointmentStatus.CANCELLED, pending.getStatusEnum());
        verify(appointmentRepository).save(pending);
        verify(appointmentRepository, never()).delete(any(Appointment.class));
        AppointmentCancelledEvent event = eventsOfType(AppointmentCancelledEvent.class).get(0);
        assertSame(pending, event.appointment());
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

        appointmentService.publicCancelAppointment("public-1", "john@test.com");

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
                () -> appointmentService.publicCancelAppointment("public-1", "john@test.com")).getMessage().contains("declined"));
        assertTrue(assertThrows(IllegalArgumentException.class,
                () -> appointmentService.publicCancelAppointment("public-2", "john@test.com")).getMessage().contains("already started"));
        assertThrows(IllegalArgumentException.class,
                () -> appointmentService.publicCancelAppointment("public-3", "wrong@test.com"));
        assertThrows(ResourceNotFoundException.class,
                () -> appointmentService.publicCancelAppointment("nope", "john@test.com"));
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
                () -> appointmentService.cancelMyAppointment("public-1", "someone-else@test.com"));
        assertThrows(IllegalArgumentException.class,
                () -> appointmentService.cancelMyAppointment("public-2", "john@test.com"));

        appointmentService.cancelMyAppointment("public-1", "John@Test.com");
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

        appointmentService.deleteAppointment(1L);
        assertEquals(AppointmentStatus.CANCELLED, past.getStatusEnum());
        assertEquals(AppointmentCancelledEvent.CancelledBy.ADMIN,
                eventsOfType(AppointmentCancelledEvent.class).get(0).cancelledBy());
        verify(appointmentRepository, never()).delete(any(Appointment.class));
        verify(appointmentRepository, never()).deleteById(any());

        assertThrows(IllegalArgumentException.class, () -> appointmentService.deleteAppointment(2L));
        events.clear();
        appointmentService.deleteAppointment(3L); // idempotent
        assertTrue(events.isEmpty());

        when(appointmentRepository.findById(9L)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> appointmentService.deleteAppointment(9L));
    }

    // ── misc ─────────────────────────────────────────────────────────────────

    @Test
    void testLockForReminderOnlyReturnsApprovedBookings() {
        when(appointmentRepository.findByIdForUpdate(1L))
                .thenReturn(Optional.of(appointment(1, AppointmentStatus.APPROVED, TOMORROW, "10:00")));
        when(appointmentRepository.findByIdForUpdate(2L))
                .thenReturn(Optional.of(appointment(2, AppointmentStatus.CANCELLED, TOMORROW, "10:00")));

        assertTrue(appointmentService.lockForReminder(1L).isPresent());
        assertTrue(appointmentService.lockForReminder(2L).isEmpty());
    }

    @Test
    void testFindAppointmentIdsNeedingRemindersAsksForApprovedOnly() {
        when(appointmentRepository.findReminderIds(TOMORROW, false, AppointmentStatus.APPROVED)).thenReturn(List.of(5L));

        assertEquals(List.of(5L), appointmentService.findAppointmentIdsNeedingReminders(TOMORROW));
    }

    @Test
    void testGetBusySlots_DelegatesAndPropagatesValidationErrors() {
        when(appointmentRepository.findActiveForBarberOnDate("Alex the Barber", TOMORROW))
                .thenReturn(List.of(appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00")));
        assertEquals(List.of("10:00"), appointmentService.getBusySlots("Alex the Barber", TOMORROW.toString()));

        assertThrows(IllegalArgumentException.class, () -> appointmentService.getBusySlots("Alex the Barber", "invalid-date"));
        when(barberRepository.findByName("Ghost")).thenReturn(Optional.empty());
        assertThrows(IllegalArgumentException.class, () -> appointmentService.getBusySlots("Ghost", TOMORROW.toString()));
    }

    @Test
    void testFindByPublicId() {
        Appointment appt = appointment(1, AppointmentStatus.PENDING, TOMORROW, "10:00");
        when(appointmentRepository.findByPublicId("public-1")).thenReturn(appt);
        assertSame(appt, appointmentService.findByPublicId("public-1"));
    }

    @Test
    void testNullEntityToResponse() {
        assertNull(AppointmentResponse.fromEntity(null));
    }
}
