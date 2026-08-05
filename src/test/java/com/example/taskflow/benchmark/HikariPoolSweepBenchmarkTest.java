package com.example.taskflow.benchmark;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.AppointmentCreateRequest;
import com.example.taskflow.appointment.Barber;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.BarberSchedule;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import com.example.taskflow.review.internal.ReviewRepository;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;

import com.example.taskflow.auth.TestSecurityConfig;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * HIKARICP POOL SIZE SWEEP UNDER VIRTUAL THREADS.
 * <p>
 * {@code §5} found "pool size 10 is optimal" for Platform Threads.
 * With Virtual Threads, threads demount while waiting for connections,
 * so a larger pool may improve utilization and throughput.
 * This benchmark sweeps sizes 5, 10, 15, 25, 50 with all other config
 * identical to {@link VirtualThreadBenchmarkTest}.
 * <p>
 * <b>Run:</b>
 * <pre>{@code
 *   ./gradlew benchmarkTest --tests *HikariPoolSweepBenchmarkTest
 * }</pre>
 */
@Tag("benchmark")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.threads.virtual.enabled=true",
        "app.rate-limit.enabled=false",
        "app.stats.cache.ttl=0"
    }
)
@Import(TestSecurityConfig.class)
class HikariPoolSweepBenchmarkTest {

    static {
        java.lang.System.setProperty("http.maxConnections", "100");
    }

    // -----------------------------------------------------------------------
    //  PARAMETERS
    // -----------------------------------------------------------------------
    static final int BARBER_COUNT = 10;
    static final int SERVICE_COUNT = 10;
    static final int APPOINTMENT_COUNT = 500;
    static final int WARMUP_REQUESTS = 200;
    static final int MEASUREMENT_REQUESTS = 1_000;
    static final int CONCURRENCY = 50;
    static final int BENCHMARK_TIMEOUT_SECONDS = 120;

    /** Pool sizes to sweep — from under-provisioned to generous */
    static final int[] POOL_SIZES = {5, 10, 15, 25, 50};

    // Workload mix (same as VirtualThreadBenchmarkTest)
    private static final double W_APPOINTMENTS = 0.30;
    private static final double W_BARBERS       = 0.20;
    private static final double W_CATALOG       = 0.20;
    private static final double W_CREATE        = 0.30;

    // -----------------------------------------------------------------------
    //  INJECTIONS
    // -----------------------------------------------------------------------
    @Autowired
    private DataSource dataSource;

    @Autowired
    private BarberRepository barberRepository;
    @Autowired
    private ServiceItemRepository serviceItemRepository;
    @Autowired
    private AppointmentRepository appointmentRepository;
    @Autowired
    private ReviewRepository reviewRepository;
    @Autowired
    private BarberTimeOffRepository barberTimeOffRepository;
    @Autowired
    private BarberScheduleRepository barberScheduleRepository;

    @LocalServerPort
    private int port;

    // -----------------------------------------------------------------------
    //  MUTABLE STATE
    // -----------------------------------------------------------------------
    private RestTemplate http;
    private String baseUrl;
    private String accessToken;
    private final Random random = new Random(42);
    private List<String> barberNames;
    private List<String> serviceNames;
    private List<String> times;

    // =========================================================================
    //  SETUP — seed DB, login once (shared for all sweep iterations)
    // =========================================================================

    @BeforeEach
    void setUp() {
        baseUrl = "http://localhost:" + port;
        http = new RestTemplate();

        // Initial seed + login (reseeding happens per-size in the sweep loop)
        seedDatabase();
        loginAndGetToken();
    }

    private void seedDatabase() {
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();

        // Barbers
        List<Barber> barbers = new ArrayList<>(BARBER_COUNT);
        for (int i = 0; i < BARBER_COUNT; i++) {
            barbers.add(new Barber("Barber " + i, "barber" + i + "@example.com",
                    "555-" + String.format("%04d", i)));
        }
        barberRepository.saveAll(barbers);
        barberNames = barbers.stream().map(Barber::getName).toList();

        // Schedules (all days, 08:00-18:00)
        for (Barber barber : barbers) {
            for (int day = 1; day <= 7; day++) {
                BarberSchedule s = new BarberSchedule();
                s.setBarber(barber);
                s.setDayOfWeek(day);
                s.setStartTime(LocalTime.of(8, 0));
                s.setEndTime(LocalTime.of(18, 0));
                barberScheduleRepository.save(s);
            }
        }

        // Services
        String[] cats = {"hair", "beard", "combo", "facial", "other"};
        List<ServiceItem> services = new ArrayList<>(SERVICE_COUNT);
        for (int i = 0; i < SERVICE_COUNT; i++) {
            services.add(new ServiceItem("Service " + i,
                    BigDecimal.valueOf(20.00 + (i * 5)), 15 + (i * 5),
                    cats[i % cats.length], "Service " + i));
        }
        serviceItemRepository.saveAll(services);
        serviceNames = services.stream().map(ServiceItem::getName).toList();

        // Appointments
        List<Appointment> appointments = new ArrayList<>(APPOINTMENT_COUNT);
        String[] statuses = {"PENDING", "APPROVED", "COMPLETED", "CANCELLED"};
        String[] tSlots = {"09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"};
        times = List.of(tSlots);
        LocalDate baseDate = LocalDate.of(2026, 6, 1);
        for (int i = 0; i < APPOINTMENT_COUNT; i++) {
            Barber b = barbers.get(i % BARBER_COUNT);
            ServiceItem sv = services.get(i % SERVICE_COUNT);
            Appointment a = new Appointment("Customer " + i, "c" + i + "@t.com",
                    "+1-555-" + i, b.getName(), baseDate.plusDays(i / (BARBER_COUNT * 2)),
                    tSlots[i % tSlots.length], sv.getName());
            a.setBarber(b);
            a.setService(sv);
            a.setStatus(statuses[i % statuses.length]);
            appointments.add(a);
        }
        appointmentRepository.saveAll(appointments);
    }

    private void loginAndGetToken() {
        Map<String, String> body = Map.of("username", "admin", "password", "admin-password");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, String>> req = new HttpEntity<>(body, headers);

        ResponseEntity<String> resp = http.postForEntity(baseUrl + "/api/v1/auth/login", req, String.class);
        assertTrue(resp.getStatusCode().is2xxSuccessful(), "Login failed");

        List<String> cookies = resp.getHeaders().get("Set-Cookie");
        if (cookies != null) {
            for (String c : cookies) {
                if (c.startsWith("access_token=")) {
                    accessToken = c.substring("access_token=".length());
                    int semi = accessToken.indexOf(';');
                    if (semi > 0) accessToken = accessToken.substring(0, semi);
                    break;
                }
            }
        }
        if (accessToken == null) accessToken = resp.getBody();
        assertTrue(accessToken != null && !accessToken.isBlank(), "No token");
    }

    // =========================================================================
    //  SWEEP BENCHMARK
    // =========================================================================

    @Test
    void sweepHikariPoolSizes() throws Exception {
        System.out.println("\n" + "=" .repeat(95));
        System.out.println("  \u2699 HIKARICP POOL SIZE SWEEP (VIRTUAL THREADS ENABLED)");
        System.out.println("  Sweeping sizes: " + Arrays.toString(POOL_SIZES));
        System.out.println("  Concurrency: " + CONCURRENCY
                + " | Workload: 30% GET apps / 20% barbers / 20% catalog / 30% POST create");
        System.out.println("=" .repeat(95));

        // Table header
        System.out.println();
        System.out.printf("  %-8s %12s %12s %10s %10s %10s %8s%n",
                "Pool", "Throughput", "Avg Lat", "p50", "p95", "p99", "Errors");
        System.out.println("  " + "-".repeat(75));

        // Results accumulator
        int[][] results = new int[POOL_SIZES.length][]; // index → [throughput_int, avg, p50, p95, p99, errors]

        for (int idx = 0; idx < POOL_SIZES.length; idx++) {
            int poolSize = POOL_SIZES[idx];
            System.out.flush();

            // --- Set pool size ---
            if (dataSource instanceof HikariDataSource hikari) {
                hikari.setMaximumPoolSize(poolSize);
                hikari.setMinimumIdle(Math.min(poolSize, 5));
            }

            // --- Reseed DB for fair comparison ---
            seedDatabase();

            // --- Warmup ---
            runLoad(WARMUP_REQUESTS);

            // --- Measure ---
            long startNs = System.nanoTime();
            List<Long> latencies = runLoad(MEASUREMENT_REQUESTS);
            long elapsedNs = System.nanoTime() - startNs;

            double sec = elapsedNs / 1_000_000_000.0;
            int throughput = (int) Math.round(MEASUREMENT_REQUESTS / sec);

            long[] sorted = latencies.stream().mapToLong(Long::longValue).sorted().toArray();
            int avg = (int) Math.round(Arrays.stream(sorted).average().orElse(0));
            int p50  = percentile(sorted, 50);
            int p95  = percentile(sorted, 95);
            int p99  = percentile(sorted, 99);
            int errors = MEASUREMENT_REQUESTS - sorted.length;

            // Print this row
            System.out.printf("  %-8s %12d %12d %10d %10d %10d %8d%n",
                    "size=" + poolSize, throughput, avg, p50, p95, p99, errors);

            results[idx] = new int[]{throughput, avg, p50, p95, p99, errors};
        }

        // Summary
        System.out.println("  " + "-".repeat(75));
        System.out.println();
        System.out.println("  \uD83D\uDCCA BEST POOL SIZE FOR VIRTUAL THREADS:");

        int bestIdx = 0;
        int bestTput = 0;
        for (int i = 0; i < POOL_SIZES.length; i++) {
            if (results[i][0] > bestTput) {
                bestTput = results[i][0];
                bestIdx = i;
            }
        }
        System.out.printf("     pool-size=%d  throughput=%d req/s  avg=%d ms  p99=%d ms%n",
                POOL_SIZES[bestIdx], results[bestIdx][0],
                results[bestIdx][1], results[bestIdx][4]);

        // Also print the baseline comparison line
        System.out.println();
        System.out.println("  \u2139 Note: PT baseline with pool-size=10 achieved ~1908 req/s,");
        System.out.println("         24.9 ms avg, 64 ms p95, 96 ms p99.");
        System.out.println();
    }

    // =========================================================================
    //  LOAD GENERATOR
    // =========================================================================

    private List<Long> runLoad(int count) throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(CONCURRENCY);
        try {
            CountDownLatch startGate = new CountDownLatch(1);
            CountDownLatch endGate = new CountDownLatch(count);
            List<Future<Long>> futures = new ArrayList<>(count);

            for (int i = 0; i < count; i++) {
                futures.add(executor.submit(() -> {
                    startGate.await();
                    long t0 = System.nanoTime();
                    try {
                        executeRandomRequest();
                    } catch (Exception ignored) {}
                    long t1 = System.nanoTime();
                    endGate.countDown();
                    return (t1 - t0) / 1_000_000L;
                }));
            }

            startGate.countDown();
            boolean ok = endGate.await(BENCHMARK_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!ok) System.err.println("  TIMEOUT after " + BENCHMARK_TIMEOUT_SECONDS + "s");

            List<Long> latencies = new ArrayList<>(count);
            for (Future<Long> f : futures) {
                if (f.isDone()) {
                    try { latencies.add(f.get()); } catch (Exception ignored) {}
                }
            }
            return latencies;
        } finally {
            executor.shutdownNow();
        }
    }

    private void executeRandomRequest() {
        double r = random.nextDouble();
        if (r < W_APPOINTMENTS) {
            getAppointments();
        } else if (r < W_APPOINTMENTS + W_BARBERS) {
            getBarbers();
        } else if (r < W_APPOINTMENTS + W_BARBERS + W_CATALOG) {
            getCatalog();
        } else {
            createAppointment();
        }
    }

    // -----------------------------------------------------------------------
    //  ENDPOINTS
    // -----------------------------------------------------------------------

    private void getAppointments() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<String> r = http.exchange(
                baseUrl + "/api/v1/appointments?page=0&size=10&status=PENDING",
                HttpMethod.GET, new HttpEntity<>(headers), String.class);
        if (!r.getStatusCode().is2xxSuccessful())
            System.err.println("  GET apps failed: " + r.getStatusCode());
    }

    private void getBarbers() {
        ResponseEntity<String> r = http.getForEntity(baseUrl + "/api/v1/barbers", String.class);
        if (!r.getStatusCode().is2xxSuccessful())
            System.err.println("  GET barbers failed: " + r.getStatusCode());
    }

    private void getCatalog() {
        ResponseEntity<String> r = http.getForEntity(baseUrl + "/api/v1/catalog", String.class);
        if (!r.getStatusCode().is2xxSuccessful())
            System.err.println("  GET catalog failed: " + r.getStatusCode());
    }

    private void createAppointment() {
        String barberName = barberNames.get(random.nextInt(barberNames.size()));
        String serviceName = serviceNames.get(random.nextInt(serviceNames.size()));
        String time = times.get(random.nextInt(times.size()));
        LocalDate date = LocalDate.of(2026, 6, 1).plusDays(random.nextInt(60));
        String cid = UUID.randomUUID().toString().substring(0, 8);

        AppointmentCreateRequest body = new AppointmentCreateRequest(
                "BM-" + cid, "bm-" + cid + "@t.com", "+1-555-" + cid,
                barberName, date, time, serviceName);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            ResponseEntity<String> r = http.exchange(baseUrl + "/api/v1/appointments",
                    HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
            if (!r.getStatusCode().is2xxSuccessful()
                    && !r.getStatusCode().equals(HttpStatus.BAD_REQUEST)) {
                System.err.println("  POST failed: " + r.getStatusCode());
            }
        } catch (Exception ignored) {}
    }

    // -----------------------------------------------------------------------
    //  UTILITY
    // -----------------------------------------------------------------------

    private static int percentile(long[] sorted, int pct) {
        if (sorted.length == 0) return 0;
        int idx = (int) Math.ceil(pct / 100.0 * sorted.length) - 1;
        return (int) sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
    }
}
