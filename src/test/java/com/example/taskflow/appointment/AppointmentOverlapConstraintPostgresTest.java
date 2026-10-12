package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.testsupport.PostgresTestServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.reset;

/**
 * V35 on a real PostgreSQL server: the {@code appointments_no_overlap} exclusion constraint closes the
 * race between overlapping bookings with <em>different</em> start times (a service longer than the
 * 60-minute grid step), which the exact-start unique index cannot see, and a violation (SQLSTATE
 * 23P01) is reported like the unique-index race: 400 on create, 409 on approve.
 *
 * <p>Tagged {@code testcontainers}: runs against {@link PostgresTestServer} (a container, or the server
 * named by {@code TASKFLOW_TEST_POSTGRES_URL}); the application is migrated into a fresh schema.
 */
@Tag("testcontainers")
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class AppointmentOverlapConstraintPostgresTest {

    private static final String BARBER = "Overlap Barber";
    private static final String LONG = "Overlap Long Treatment"; // 90 minutes
    private static final String CUT = "Overlap Cut";             // 30 minutes

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) throws SQLException {
        String base = PostgresTestServer.jdbcUrl();
        String user = PostgresTestServer.user();
        String password = PostgresTestServer.password();
        String schema = "ov_" + System.nanoTime();
        try (Connection c = DriverManager.getConnection(base, user, password);
             Statement st = c.createStatement()) {
            st.execute("CREATE SCHEMA " + schema);
        }
        String url = base + (base.contains("?") ? "&" : "?") + "currentSchema=" + schema;
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> user);
        registry.add("spring.datasource.password", () -> password);
        registry.add("spring.datasource.driverClassName", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
    }

    @Autowired private AppointmentService appointmentService;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private BarberRepository barberRepository;
    @Autowired private BarberScheduleRepository barberScheduleRepository;
    @Autowired private ServiceItemRepository serviceItemRepository;
    @Autowired private com.example.taskflow.review.internal.ReviewRepository reviewRepository;
    @Autowired private CacheManager cacheManager;
    @Autowired private DataSource dataSource;
    @Autowired private JdbcTemplate jdbcTemplate;

    @MockitoSpyBean private BusySlotsService busySlotsService;

    private LocalDate date;

    @BeforeEach
    void setUp() {
        reset(busySlotsService);
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        Cache busySlots = cacheManager.getCache("busySlots");
        if (busySlots != null) {
            busySlots.clear();
        }
        if (barberRepository.findByName(BARBER).isEmpty()) {
            Barber barber = barberRepository.save(new Barber(BARBER, "overlap@taskflow.test", "555-0100"));
            for (int day = 1; day <= 6; day++) {
                BarberSchedule schedule = new BarberSchedule();
                schedule.setBarber(barber);
                schedule.setDayOfWeek(day);
                schedule.setStartTime(LocalTime.of(9, 0));
                schedule.setEndTime(LocalTime.of(17, 0));
                barberScheduleRepository.save(schedule);
            }
        }
        if (serviceItemRepository.findByName(LONG).isEmpty()) {
            serviceItemRepository.save(new ServiceItem(LONG, new BigDecimal("60.00"), 90, "hair", ""));
        }
        if (serviceItemRepository.findByName(CUT).isEmpty()) {
            serviceItemRepository.save(new ServiceItem(CUT, new BigDecimal("25.00"), 30, "hair", ""));
        }
        date = nextWorkingDay(LocalDate.now().plusDays(7));
    }

    private static LocalDate nextWorkingDay(LocalDate from) {
        return from.getDayOfWeek() == DayOfWeek.SUNDAY ? from.plusDays(1) : from;
    }

    private AppointmentCreateRequest request(String email, LocalDate day, String time, String service) {
        return new AppointmentCreateRequest("Overlap Customer", email, "555-0500", BARBER, day, time, service);
    }

    @Test
    void migrationCreatesTheExclusionConstraintAndStoresEndTimes() {
        String definition = jdbcTemplate.queryForObject("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                + "WHERE conname = 'appointments_no_overlap' AND conrelid = 'appointments'::regclass", String.class);
        assertTrue(definition.startsWith("EXCLUDE USING gist (barber_name WITH =, tsrange("), definition);
        assertTrue(definition.contains("WHERE"), definition);

        AppointmentResponse created = appointmentService.createAppointment(
                request("stored@example.com", date, "10:00", LONG), null).appointment();
        assertEquals(LocalTime.of(11, 30),
                appointmentRepository.findById(created.id()).orElseThrow().getBookingEndTime());
    }

    /** Plain JDBC: the second, overlapping insert waits for the first transaction and then fails with 23P01. */
    @Test
    void overlappingInsertWithADifferentStartWaitsForTheFirstAndThenFails() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection first = dataSource.getConnection()) {
            first.setAutoCommit(false);
            insert(first, "10:00", "11:30"); // 90-minute service at 10:00, not committed yet

            Future<?> second = pool.submit(() -> {
                try (Connection c = dataSource.getConnection()) {
                    c.setAutoCommit(false);
                    insert(c, "11:00", "12:00");
                    c.commit();
                }
                return null;
            });
            Thread.sleep(500);
            assertFalse(second.isDone(), "the overlapping insert must wait for the first transaction");

            first.commit();
            ExecutionException failure = assertThrows(ExecutionException.class, () -> second.get(10, TimeUnit.SECONDS));
            SQLException sql = assertInstanceOf(SQLException.class, failure.getCause());
            assertEquals("23P01", sql.getSQLState());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, appointmentRepository.count());
        // back to back is fine: [11:30, 12:30) does not overlap [10:00, 11:30)
        try (Connection c = dataSource.getConnection()) {
            insert(c, "11:30", "12:30");
        }
        assertEquals(2, appointmentRepository.count());
    }

    private void insert(Connection c, String start, String end) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO appointments (customer_name, customer_email, "
                + "customer_phone, barber_name, booking_date, booking_time, booking_end_time, service_type, status, "
                + "public_id, created_at, updated_at) VALUES ('Raw', 'raw@example.com', '1', ?, ?, "
                + "CAST(? AS TIME), CAST(? AS TIME), 'Raw', 'PENDING', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")) {
            ps.setString(1, BARBER);
            ps.setObject(2, date);
            ps.setString(3, start);
            ps.setString(4, end);
            ps.setString(5, UUID.randomUUID().toString());
            ps.executeUpdate();
        }
    }

    /**
     * Through the application: a 90-minute booking at 10:00 and a booking at 11:00 for the same barber
     * and date, submitted concurrently. Whether the loser is stopped by the in-transaction check or by
     * the exclusion constraint depends on timing; either way exactly one is created and the other is a 400.
     */
    @Test
    void concurrentOverlappingBookingsWithDifferentStartTimesYieldExactlyOneSuccess() throws Exception {
        for (int round = 0; round < 5; round++) {
            LocalDate day = date.plusWeeks(round + 1L); // same (working) weekday, a fresh date per round
            List<AppointmentCreateRequest> requests = List.of(
                    request("long-" + round + "@example.com", day, "10:00", LONG),
                    request("cut-" + round + "@example.com", day, "11:00", CUT));
            ExecutorService pool = Executors.newFixedThreadPool(requests.size());
            CountDownLatch ready = new CountDownLatch(requests.size());
            CountDownLatch start = new CountDownLatch(1);
            List<Future<AppointmentCreationResult>> futures = new ArrayList<>();
            for (AppointmentCreateRequest request : requests) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return appointmentService.createAppointment(request, null);
                }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();

            int created = 0;
            int rejected = 0;
            for (Future<AppointmentCreationResult> future : futures) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                    created++;
                } catch (ExecutionException e) {
                    assertInstanceOf(IllegalArgumentException.class, e.getCause(), String.valueOf(e.getCause()));
                    rejected++;
                }
            }
            pool.shutdown();

            assertEquals(1, created, "round " + round + ": exactly one booking may win");
            assertEquals(1, rejected, "round " + round + ": the other is a 400");
            assertEquals(1, appointmentRepository.findActiveForBarberOnDate(BARBER, day).size());
        }
    }

    /** The in-transaction check is bypassed (as if it ran before the other booking committed): the constraint decides. */
    @Test
    void anOverlapThatSlipsPastTheCheckIsRejectedByTheConstraintAsASlotCollision() {
        appointmentService.createAppointment(request("first@example.com", date, "10:00", LONG), null);
        doReturn(Optional.empty()).when(busySlotsService)
                .findConflict(any(), eq(date), eq(LocalTime.of(11, 0)), anyInt(), any());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> appointmentService.createAppointment(request("second@example.com", date, "11:00", CUT), null));
        assertTrue(ex.getMessage().contains("just booked"), ex.getMessage());
        assertEquals(1, appointmentRepository.findActiveForBarberOnDate(BARBER, date).size());
    }

    @Test
    void reApprovingADeniedBookingIntoAnOverlapIsAConflict() {
        long denied = appointmentService.createAppointment(
                request("denied@example.com", date, "10:00", LONG), null).appointment().id();
        appointmentService.updateAppointmentStatus(denied, new AppointmentUpdateRequest("DENIED"));
        // the slot is free again, so 11:00 can be booked
        appointmentService.createAppointment(request("taken@example.com", date, "11:00", CUT), null);

        // the re-check would refuse it too; bypass it to prove the database refuses the overlap on its own
        doReturn(Optional.empty()).when(busySlotsService)
                .findConflict(any(), eq(date), eq(LocalTime.of(10, 0)), anyInt(), eq(denied));
        ConflictException ex = assertThrows(ConflictException.class,
                () -> appointmentService.updateAppointmentStatus(denied, new AppointmentUpdateRequest("APPROVED")));
        assertTrue(ex.getMessage().contains("already booked"), ex.getMessage());
        assertEquals(AppointmentStatus.DENIED, appointmentRepository.findById(denied).orElseThrow().getStatusEnum());
    }
}
