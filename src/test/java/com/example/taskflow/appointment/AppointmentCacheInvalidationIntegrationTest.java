package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * User-visible availability-cache correctness: every availability mutation must
 * evict both the concrete-barber key and the "First Available" aggregate key,
 * and only after the transaction commits.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "spring.cache.type=simple"})
class AppointmentCacheInvalidationIntegrationTest {

    @Autowired
    private CacheManager cacheManager;

    @Autowired
    private BusySlotsService busySlotsService;

    @Autowired
    private AppointmentService appointmentService;

    @Autowired
    private BarberService barberService;

    @Autowired
    private AppointmentStatsService statsService;

    @Autowired
    private AppointmentRepository appointmentRepository;

    @Autowired
    private BarberRepository barberRepository;

    @Autowired
    private BarberScheduleRepository barberScheduleRepository;

    @Autowired
    private BarberTimeOffRepository barberTimeOffRepository;

    @Autowired
    private ServiceItemRepository serviceItemRepository;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private TransactionTemplate transactionTemplate;

    private static final String BARBER = "Alex the Barber";
    private static final String SERVICE = "Classic Haircut";
    private static final LocalDate DATE = LocalDate.of(2030, 5, 16);

    private Cache busySlotsCache;

    @BeforeEach
    void setUp() {
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();

        Cache cache = cacheManager.getCache(AppointmentStatsService.BUSY_SLOTS_CACHE);
        assertNotNull(cache);
        cache.clear();
        busySlotsCache = cache;
        Cache statsCache = cacheManager.getCache(AppointmentStatsService.STATS_CACHE);
        if (statsCache != null) {
            statsCache.clear();
        }

        transactionTemplate = new TransactionTemplate(transactionManager);
        serviceItemRepository.save(new ServiceItem(SERVICE, new BigDecimal("25.00"), 30, "hair", ""));

        Barber barber = new Barber(BARBER, "alex@taskflow.com", "555-1234");
        barber = barberRepository.save(barber);

        BarberSchedule schedule = new BarberSchedule();
        schedule.setBarber(barber);
        schedule.setDayOfWeek(DATE.getDayOfWeek().getValue());
        schedule.setStartTime(LocalTime.of(9, 0));
        schedule.setEndTime(LocalTime.of(17, 0));
        barberScheduleRepository.save(schedule);
    }

    private void primeAvailability() {
        busySlotsService.getBusySlots(BARBER, DATE.toString());
        busySlotsService.getBusySlots(AppointmentServiceImpl.NO_PREFERENCE_BARBER, DATE.toString());
        assertNotNull(busySlotsCache.get(BARBER + "-" + DATE));
        assertNotNull(busySlotsCache.get(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-" + DATE));
    }

    private void assertAvailabilityEvicted() {
        assertNull(busySlotsCache.get(BARBER + "-" + DATE),
                "concrete busy-slots entry must be evicted");
        assertNull(busySlotsCache.get(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-" + DATE),
                "First Available aggregate must be evicted");
    }

    private AppointmentCreateRequest bookingRequest(String time) {
        return new AppointmentCreateRequest(
                "John Doe", "john@test.com", "555-0000", BARBER, DATE, time, SERVICE);
    }

    @Test
    void booking_evictsConcreteAndAggregateAndStats() {
        // Seed one row first: the stats aggregate uses bare SUM() which returns
        // NULL on an empty table (pre-existing query behaviour, out of scope here).
        var created = appointmentService.createAppointment(bookingRequest("10:00"), null);
        primeAvailability();
        statsService.getStatsCached(appointmentRepository);
        assertNotNull(cacheManager.getCache(AppointmentStatsService.STATS_CACHE).get(LocalDate.now()));

        appointmentService.updateAppointmentStatus(created.appointment().id(),
                new AppointmentUpdateRequest("APPROVED"));

        assertAvailabilityEvicted();
        assertNull(cacheManager.getCache(AppointmentStatsService.STATS_CACHE).get(LocalDate.now()),
                "appointmentStats entry must be evicted after a mutation");
    }

    @Test
    void aggregateReflectsBookingImmediately() {
        primeAvailability();

        appointmentService.createAppointment(bookingRequest("10:00"), null);

        List<String> aggregate = busySlotsService.getBusySlots(
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, DATE.toString());
        assertTrue(aggregate.contains("10:00"),
                "the only barber is now booked, so 10:00 must be busy for First Available");
        assertTrue(busySlotsService.getBusySlots(BARBER, DATE.toString()).contains("10:00"));
    }

    @Test
    void statusChange_evictsBoth() {
        var created = appointmentService.createAppointment(bookingRequest("10:00"), null);
        primeAvailability();

        appointmentService.updateAppointmentStatus(created.appointment().id(),
                new AppointmentUpdateRequest("DENIED"));

        assertAvailabilityEvicted();
    }

    @Test
    void delete_evictsBoth() {
        var created = appointmentService.createAppointment(bookingRequest("10:00"), null);
        primeAvailability();

        appointmentService.deleteAppointment(created.appointment().id());

        assertAvailabilityEvicted();
    }

    @Test
    void publicCancel_evictsBoth() {
        var created = appointmentService.createAppointment(bookingRequest("10:00"), null);
        primeAvailability();

        appointmentService.publicCancelAppointment(created.appointment().publicId(), "john@test.com");

        assertAvailabilityEvicted();
    }

    @Test
    void timeOff_evictsBothForEveryDateInRange() {
        LocalDate secondDate = DATE.plusDays(1);
        busySlotsService.getBusySlots(BARBER, DATE.toString());
        busySlotsService.getBusySlots(AppointmentServiceImpl.NO_PREFERENCE_BARBER, DATE.toString());
        busySlotsService.getBusySlots(BARBER, secondDate.toString());
        busySlotsService.getBusySlots(AppointmentServiceImpl.NO_PREFERENCE_BARBER, secondDate.toString());

        Long barberId = barberRepository.findByName(BARBER).orElseThrow().getId();
        barberService.addTimeOff(barberId, new BarberTimeOffRequest(DATE, secondDate, "Vacation"));

        assertNull(busySlotsCache.get(BARBER + "-" + DATE));
        assertNull(busySlotsCache.get(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-" + DATE));
        assertNull(busySlotsCache.get(BARBER + "-" + secondDate));
        assertNull(busySlotsCache.get(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-" + secondDate));
    }

    @Test
    void createBarber_invalidatesWholeAvailabilityCache() {
        primeAvailability();

        barberService.createBarber(new BarberRequest("New Barber", "new@taskflow.com", "555-2222"));

        assertAvailabilityEvicted();
    }

    @Test
    void rolledBackTransaction_doesNotEvict() {
        primeAvailability();

        // Publish the availability event inside a transaction that then rolls
        // back: the AFTER_COMMIT listener must not run, so the primed entries
        // survive. This is the property the previous in-transaction eviction
        // could not provide.
        assertThrows(IllegalStateException.class, () -> transactionTemplate.executeWithoutResult(status -> {
            eventPublisher.publishEvent(AvailabilityChangedEvent.single(BARBER, DATE));
            throw new IllegalStateException("forced rollback");
        }));

        assertNotNull(busySlotsCache.get(BARBER + "-" + DATE));
        assertNotNull(busySlotsCache.get(AppointmentServiceImpl.NO_PREFERENCE_BARBER + "-" + DATE));
    }
}
