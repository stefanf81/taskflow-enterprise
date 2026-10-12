package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.core.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class BarberServiceImplTest {

    @Mock
    private BarberRepository barberRepository;

    @Mock
    private BarberScheduleRepository scheduleRepository;

    @Mock
    private BarberTimeOffRepository timeOffRepository;

    @Mock
    private AppointmentRepository appointmentRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    /** Monday 2026-07-20, 08:00 shop time. */
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-20T08:00:00Z"), ZoneOffset.UTC);

    private BarberServiceImpl barberService;
    private final List<Object> events = new ArrayList<>();

    @BeforeEach
    void setUp() {
        barberService = new BarberServiceImpl(barberRepository, scheduleRepository, timeOffRepository,
                appointmentRepository, eventPublisher, CLOCK, BookingProperties.defaults());
        lenient().doAnswer(inv -> events.add(inv.getArgument(0))).when(eventPublisher).publishEvent(any(Object.class));
    }

    private <T> List<T> eventsOfType(Class<T> type) {
        return events.stream().filter(type::isInstance).map(type::cast).toList();
    }

    @Test
    void getPublicBarbers_shouldReturnOnlyPublicFields() {
        PublicBarberResponse projected = new PublicBarberResponse(1L, "Alex");
        when(barberRepository.findAllPublicProjectedBy()).thenReturn(List.of(projected));

        List<PublicBarberResponse> result = barberService.getPublicBarbers();

        assertEquals(List.of(projected), result);
    }

    @Test
    void getAllBarbers_shouldReturnList() {
        BarberResponse projected = new BarberResponse(1L, "Alex", "alex@test.com", "555-1234");
        when(barberRepository.findAllProjectedBy()).thenReturn(List.of(projected));

        List<BarberResponse> result = barberService.getAllBarbers();

        assertEquals(1, result.size());
        assertEquals("Alex", result.get(0).name());
    }

    @Test
    void createBarber_shouldPersistAndReturn() {
        BarberRequest request = new BarberRequest("Alex", "alex@test.com", "555-1234");
        Barber saved = new Barber();
        saved.setId(1L);
        saved.setName("Alex");
        saved.setEmail("alex@test.com");
        saved.setPhone("555-1234");
        when(barberRepository.save(any(Barber.class))).thenReturn(saved);

        BarberResponse result = barberService.createBarber(request);

        assertEquals("Alex", result.name());
        // A new barber can serve every date, so the whole availability cache is
        // invalidated after commit via the all-barbers event.
        assertTrue(eventsOfType(AvailabilityChangedEvent.class).get(0).affectsAllBarbers());
    }

    /** BKG-6b: a new barber must come with a schedule, otherwise nobody can ever book them. */
    @Test
    @SuppressWarnings("unchecked")
    void createBarber_createsTheDefaultMondayToSaturdayShift() {
        Barber saved = new Barber();
        saved.setId(5L);
        saved.setName("Newbie");
        when(barberRepository.save(any(Barber.class))).thenReturn(saved);

        barberService.createBarber(new BarberRequest("Newbie", null, null));

        ArgumentCaptor<List<BarberSchedule>> captor = ArgumentCaptor.forClass(List.class);
        verify(scheduleRepository).saveAll(captor.capture());
        List<BarberSchedule> schedules = captor.getValue();
        assertEquals(6, schedules.size());
        assertEquals(List.of(1, 2, 3, 4, 5, 6), schedules.stream().map(BarberSchedule::getDayOfWeek).toList());
        schedules.forEach(schedule -> {
            assertEquals(LocalTime.of(9, 0), schedule.getStartTime());
            assertEquals(LocalTime.of(17, 0), schedule.getEndTime());
            assertSame(saved, schedule.getBarber());
        });
    }

    @Test
    @SuppressWarnings("unchecked")
    void createBarber_defaultShiftIsConfigurable() {
        BarberServiceImpl custom = new BarberServiceImpl(barberRepository, scheduleRepository, timeOffRepository,
                appointmentRepository, eventPublisher, CLOCK,
                new BookingProperties(90, 5, "10:00", "15:30", List.of(2, 4)));
        Barber saved = new Barber();
        saved.setId(5L);
        saved.setName("Part timer");
        when(barberRepository.save(any(Barber.class))).thenReturn(saved);

        custom.createBarber(new BarberRequest("Part timer", null, null));

        ArgumentCaptor<List<BarberSchedule>> captor = ArgumentCaptor.forClass(List.class);
        verify(scheduleRepository).saveAll(captor.capture());
        assertEquals(List.of(2, 4), captor.getValue().stream().map(BarberSchedule::getDayOfWeek).toList());
        assertEquals(LocalTime.of(10, 0), captor.getValue().get(0).getStartTime());
        assertEquals(LocalTime.of(15, 30), captor.getValue().get(0).getEndTime());
    }

    @Test
    void getTimeOff_shouldReturnList() {
        BarberTimeOff timeOff = new BarberTimeOff();
        timeOff.setId(1L);
        timeOff.setStartDate(LocalDate.of(2026, 7, 22));
        timeOff.setEndDate(LocalDate.of(2026, 7, 23));
        when(timeOffRepository.findByBarberId(1L)).thenReturn(List.of(timeOff));

        List<BarberTimeOffResponse> result = barberService.getTimeOff(1L);

        assertEquals(1, result.size());
        assertEquals(LocalDate.of(2026, 7, 22), result.get(0).startDate());
    }

    @Test
    void addTimeOff_shouldCreateAndReturn() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex the Barber");
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 22), LocalDate.of(2026, 7, 23), "Vacation");
        BarberTimeOff saved = new BarberTimeOff();
        saved.setId(1L);
        saved.setStartDate(LocalDate.of(2026, 7, 22));
        saved.setEndDate(LocalDate.of(2026, 7, 23));
        saved.setReason("Vacation");
        when(timeOffRepository.save(any(BarberTimeOff.class))).thenReturn(saved);

        BarberTimeOffResponse result = barberService.addTimeOff(1L, request);

        assertNotNull(result);
        assertEquals(LocalDate.of(2026, 7, 22), result.startDate());
        // The full inclusive range is published; the AFTER_COMMIT listener evicts
        // both the concrete and the First-Available aggregate key per date.
        AvailabilityChangedEvent event = eventsOfType(AvailabilityChangedEvent.class).get(0);
        assertFalse(event.affectsAllBarbers());
        assertEquals("Alex the Barber", event.barberName());
        assertEquals(LocalDate.of(2026, 7, 22), event.startDate());
        assertEquals(LocalDate.of(2026, 7, 23), event.endDate());
    }

    @Test
    void addTimeOff_shouldThrowWhenBarberNotFound() {
        when(barberRepository.findById(99L)).thenReturn(Optional.empty());

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 22), LocalDate.of(2026, 7, 23), "Vacation");

        assertThrows(ResourceNotFoundException.class, () -> barberService.addTimeOff(99L, request));
    }

    @Test
    void addTimeOff_shouldThrowWhenDateRangeInvalid() {
        Barber barber = new Barber();
        barber.setId(1L);
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));

        BarberTimeOffRequest request = new BarberTimeOffRequest(LocalDate.of(2026, 7, 25), LocalDate.of(2026, 7, 22), "Bad range");

        assertThrows(IllegalArgumentException.class, () -> barberService.addTimeOff(1L, request));
    }

    // ── BKG-6a: time off cancels the bookings it makes impossible ─────────────

    private Appointment booking(long id, String barberName, LocalDate date, String time, AppointmentStatus status) {
        Appointment appointment = new Appointment("Cust " + id, "c" + id + "@test.com", "1", barberName, date, time, "Haircut");
        appointment.setId(id);
        appointment.setStatus(status);
        return appointment;
    }

    @Test
    void addTimeOff_cancelsActiveFutureBookingsInTheRangeAndNotifiesCustomers() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex the Barber");
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));
        BarberTimeOff saved = new BarberTimeOff();
        saved.setId(1L);
        saved.setStartDate(LocalDate.of(2026, 7, 21));
        saved.setEndDate(LocalDate.of(2026, 7, 22));
        when(timeOffRepository.save(any(BarberTimeOff.class))).thenReturn(saved);

        Appointment pending = booking(10, "Alex the Barber", LocalDate.of(2026, 7, 21), "10:00", AppointmentStatus.PENDING);
        Appointment approved = booking(11, "Alex the Barber", LocalDate.of(2026, 7, 22), "14:00", AppointmentStatus.APPROVED);
        when(appointmentRepository.findActiveForBarberInRange("Alex the Barber",
                LocalDate.of(2026, 7, 21), LocalDate.of(2026, 7, 22))).thenReturn(List.of(pending, approved));
        when(appointmentRepository.save(any(Appointment.class))).thenAnswer(inv -> inv.getArgument(0));

        barberService.addTimeOff(1L, new BarberTimeOffRequest(
                LocalDate.of(2026, 7, 21), LocalDate.of(2026, 7, 22), "Vacation"));

        assertEquals(AppointmentStatus.CANCELLED, pending.getStatusEnum());
        assertEquals(AppointmentStatus.CANCELLED, approved.getStatusEnum());
        List<AppointmentCancelledEvent> cancelled = eventsOfType(AppointmentCancelledEvent.class);
        assertEquals(2, cancelled.size());
        assertTrue(cancelled.stream().allMatch(
                e -> e.cancelledBy() == AppointmentCancelledEvent.CancelledBy.BARBER_UNAVAILABLE));
        // caches are evicted for the whole range and the admin dashboards are refreshed
        assertEquals(1, eventsOfType(AvailabilityChangedEvent.class).size());
        assertEquals(2, eventsOfType(AppointmentAdminEvent.class).size());
    }

    @Test
    void addTimeOff_leavesPastDatesAndEarlierHoursTodayAlone() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex the Barber");
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));
        when(timeOffRepository.save(any(BarberTimeOff.class))).thenAnswer(inv -> inv.getArgument(0));

        // The clock reads Monday 2026-07-20 08:00. The range starts last week: only [today, end] is queried.
        Appointment earlierToday = booking(10, "Alex the Barber", LocalDate.of(2026, 7, 20), "07:00", AppointmentStatus.APPROVED);
        Appointment laterToday = booking(11, "Alex the Barber", LocalDate.of(2026, 7, 20), "09:00", AppointmentStatus.APPROVED);
        when(appointmentRepository.findActiveForBarberInRange("Alex the Barber",
                LocalDate.of(2026, 7, 20), LocalDate.of(2026, 7, 24))).thenReturn(List.of(earlierToday, laterToday));
        when(appointmentRepository.save(any(Appointment.class))).thenAnswer(inv -> inv.getArgument(0));

        barberService.addTimeOff(1L, new BarberTimeOffRequest(
                LocalDate.of(2026, 7, 13), LocalDate.of(2026, 7, 24), "Long leave"));

        assertEquals(AppointmentStatus.APPROVED, earlierToday.getStatusEnum());
        assertEquals(AppointmentStatus.CANCELLED, laterToday.getStatusEnum());
        assertEquals(1, eventsOfType(AppointmentCancelledEvent.class).size());
    }

    @Test
    void addTimeOff_entirelyInThePastCancelsNothing() {
        Barber barber = new Barber();
        barber.setId(1L);
        barber.setName("Alex the Barber");
        when(barberRepository.findById(1L)).thenReturn(Optional.of(barber));
        when(timeOffRepository.save(any(BarberTimeOff.class))).thenAnswer(inv -> inv.getArgument(0));

        barberService.addTimeOff(1L, new BarberTimeOffRequest(
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 3), "Backfilled"));

        verify(appointmentRepository, never()).findActiveForBarberInRange(any(), any(), any());
        assertTrue(eventsOfType(AppointmentCancelledEvent.class).isEmpty());
    }
}
