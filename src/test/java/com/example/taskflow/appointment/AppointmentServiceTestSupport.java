package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;

import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItem;
import io.micrometer.tracing.Tracer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;

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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

/**
 * Shared fixture of the appointment service unit tests ({@link AppointmentBookingServiceTest},
 * {@link AppointmentLifecycleServiceTest}, {@link AppointmentQueryServiceTest},
 * {@link AppointmentServiceImplTest}): mocked repositories, a real {@link BusySlotsService} over them,
 * one barber (Alex, 09:00-17:00) and one 30-minute haircut, and every published event captured.
 */
@ExtendWith(MockitoExtension.class)
abstract class AppointmentServiceTestSupport {

    /** Monday 2026-10-12, 08:00 shop time (UTC). */
    static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-12T08:00:00Z"), ZoneOffset.UTC);
    static final LocalDate TODAY = LocalDate.of(2026, 10, 12);
    static final LocalDate TOMORROW = TODAY.plusDays(1);

    @Mock
    AppointmentRepository appointmentRepository;

    @Mock
    ApplicationEventPublisher eventPublisher;

    @Mock
    AppointmentStatsService statsService;

    @Mock
    Tracer tracer;

    @Mock
    BarberRepository barberRepository;

    @Mock
    CatalogService catalogService;

    @Mock
    BarberScheduleRepository barberScheduleRepository;

    @Mock
    BarberTimeOffRepository barberTimeOffRepository;

    @Mock
    PlatformTransactionManager transactionManager;

    BusySlotsService busySlotsService;

    AppointmentBookingService bookingService;
    AppointmentLifecycleService lifecycleService;
    AppointmentQueryService queryService;
    AppointmentServiceImpl appointmentService;

    Barber alex;
    ServiceItem haircut;
    final List<Object> events = new ArrayList<>();

    @BeforeEach
    void setUpServices() {
        busySlotsService = new BusySlotsService(barberRepository, barberScheduleRepository, barberTimeOffRepository, appointmentRepository);
        bookingService = bookingService(CLOCK);
        lifecycleService = new AppointmentLifecycleService(appointmentRepository, changes(CLOCK), busySlotsService, barberRepository, CLOCK);
        queryService = new AppointmentQueryService(appointmentRepository, statsService, CLOCK);
        appointmentService = new AppointmentServiceImpl(appointmentRepository);

        alex = new Barber();
        alex.setId(7L);
        alex.setName("Alex the Barber");
        BarberSchedule schedule = new BarberSchedule();
        schedule.setStartTime(LocalTime.of(9, 0));
        schedule.setEndTime(LocalTime.of(17, 0));
        schedule.setBarber(alex);
        haircut = new ServiceItem("Haircut", new BigDecimal("25.00"), 30, "hair", "");

        lenient().when(barberRepository.findByName("Alex the Barber")).thenReturn(Optional.of(alex));
        lenient().when(barberRepository.findByIdForBooking(7L)).thenReturn(Optional.of(alex));
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

    /** A booking service whose "now" (and shop time zone) is {@code clock}. */
    AppointmentBookingService bookingService(Clock clock) {
        return new AppointmentBookingService(appointmentRepository, changes(clock), busySlotsService, barberRepository,
                catalogService, clock, BookingProperties.defaults(), transactionManager);
    }

    private AppointmentChangePublisher changes(Clock clock) {
        return new AppointmentChangePublisher(eventPublisher, tracer, clock);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    AppointmentCreateRequest request(String barber, LocalDate date, String time) {
        return new AppointmentCreateRequest("John Doe", "john@test.com", "123", barber, date, time, "Haircut");
    }

    Appointment appointment(long id, AppointmentStatus status, LocalDate date, String time) {
        Appointment appointment = new Appointment("John Doe", "john@test.com", "123",
                "Alex the Barber", date, time, "Haircut");
        appointment.setId(id);
        appointment.setPublicId("public-" + id);
        appointment.setBarber(alex);
        appointment.setService(haircut);
        appointment.setStatus(status);
        return appointment;
    }

    <T> List<T> eventsOfType(Class<T> type) {
        return events.stream().filter(type::isInstance).map(type::cast).toList();
    }
}
