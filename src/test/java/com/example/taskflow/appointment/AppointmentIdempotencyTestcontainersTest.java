package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * PostgreSQL parity for the idempotency race. Two or more concurrent requests
 * with the same {@code Idempotency-Key} must produce exactly one appointment and
 * return a verified replay for the losers — including when the loser's insert
 * hits the unique index after the winner commits.
 */
@Tag("testcontainers")
@SpringBootTest(properties = "app.rate-limit.enabled=false")
@AutoConfigureMockMvc
@Testcontainers
class AppointmentIdempotencyTestcontainersTest {

    private static final String BARBER = "Race Barber";
    private static final String SERVICE = "Race Cut";

    @Container
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18.6-alpine")
            .withDatabaseName("taskflow_test")
            .withUsername("postgres")
            .withPassword("postgres-password");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driverClassName", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
        registry.add("spring.flyway.enabled", () -> "true");
    }

    @Autowired
    private AppointmentService appointmentService;

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
    private CacheManager cacheManager;

    @BeforeEach
    void setUp() {
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        Cache busySlots = cacheManager.getCache("busySlots");
        if (busySlots != null) {
            busySlots.clear();
        }
        ensureBarber();
        ensureService();
    }

    private void ensureBarber() {
        if (barberRepository.findByName(BARBER).isPresent()) {
            return;
        }
        Barber barber = barberRepository.save(new Barber(BARBER, "race@taskflow.com", "555-0100"));
        for (int day = 1; day <= 6; day++) {
            BarberSchedule schedule = new BarberSchedule();
            schedule.setBarber(barber);
            schedule.setDayOfWeek(day);
            schedule.setStartTime(LocalTime.of(9, 0));
            schedule.setEndTime(LocalTime.of(17, 0));
            barberScheduleRepository.save(schedule);
        }
    }

    private void ensureService() {
        if (serviceItemRepository.findByName(SERVICE).isEmpty()) {
            serviceItemRepository.save(new ServiceItem(SERVICE, new BigDecimal("25.00"), 30, "hair", ""));
        }
    }

    @Test
    void concurrentSameKey_producesOneRowAndReplaysForLosers() throws Exception {
        LocalDate date = LocalDate.now().plusDays(1);
        while (date.getDayOfWeek() == DayOfWeek.SUNDAY) {
            date = date.plusDays(1);
        }
        AppointmentCreateRequest request = new AppointmentCreateRequest(
                "Race Customer", "race@example.com", "555-0500", BARBER, date, "10:00", SERVICE);

        int threads = 4;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<AppointmentCreationResult>> futures = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                ready.countDown();
                start.await();
                return appointmentService.createAppointment(request, "race-key");
            }));
        }

        assertTrue(ready.await(10, TimeUnit.SECONDS));
        start.countDown();

        List<AppointmentCreationResult> results = new ArrayList<>();
        for (Future<AppointmentCreationResult> future : futures) {
            results.add(future.get(30, TimeUnit.SECONDS));
        }
        pool.shutdown();

        assertEquals(1, appointmentRepository.count(),
                "exactly one appointment must be persisted for one Idempotency-Key");
        assertEquals(1, results.stream().filter(result -> !result.replayed()).count(),
                "exactly one request must be the creator");
        assertEquals(threads - 1, results.stream().filter(AppointmentCreationResult::replayed).count(),
                "every other request must be a verified replay");
        assertEquals(1, results.stream().map(result -> result.appointment().id()).distinct().count(),
                "all results must reference the same appointment");
    }
}
