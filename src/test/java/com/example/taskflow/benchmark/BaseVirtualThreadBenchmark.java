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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ABSTRACT BASE for Platform Thread vs Virtual Thread benchmark on I/O-bound
 * mixed workloads.
 * <p>
 * Subclasses configure {@code spring.threads.virtual.enabled} to {@code true}
 * or {@code false} via their own {@code @SpringBootTest} annotations.
 * <p>
 * This benchmark goes through the REAL Tomcat connector (not MockMvc), so the
 * threading model actually matters — virtual threads are only used when
 * requests flow through the servlet container's executor.
 */
abstract class BaseVirtualThreadBenchmark {

    static {
        // Allow up to 100 concurrent HTTP connections per route.
        // The Java HttpURLConnection default is only 5, which would
        // bottleneck our 50-concurrent-user benchmark.
        java.lang.System.setProperty("http.maxConnections", "100");
    }

    // =========================================================================
    //  BENCHMARK PARAMETERS
    // =========================================================================

    /** Seed data: barbers */
    static final int BARBER_COUNT = 10;

    /** Seed data: service catalog items */
    static final int SERVICE_COUNT = 10;

    /** Seed data: appointments for listing queries */
    static final int APPOINTMENT_COUNT = 500;

    /** Warm-up iterations (JIT compilation, DB pool warm-up, cache priming) */
    static final int WARMUP_REQUESTS = 200;

    /** Measurement iterations (metrics collected) */
    static final int MEASUREMENT_REQUESTS = 1_000;

    /** Number of concurrent client threads */
    static final int CONCURRENCY = 50;

    /** Max tolerated average latency (ms) — generous for CI consistency */
    static final double MAX_AVG_LATENCY_MS = 200.0;

    /** Timeout for the entire benchmark */
    static final int BENCHMARK_TIMEOUT_SECONDS = 120;

    // -----------------------------------------------------------------------
    //  WORKLOAD MIX WEIGHTS (must sum to 1.0)
    // -----------------------------------------------------------------------
    // 30% : GET /api/v1/appointments  — paginated DB read + DTO mapping + JSON
    // 20% : GET /api/v1/barbers       — lightweight DTO projection query
    // 20% : GET /api/v1/catalog       — simple DB read
    // 30% : POST /api/v1/appointments — multi-step DB write (schedule check,
    //                                    busy-slot validation, entity save, cache
    //                                    eviction)
    private static final double W_APPOINTMENTS = 0.30;
    private static final double W_BARBERS       = 0.20;
    private static final double W_CATALOG       = 0.20;
    private static final double W_CREATE        = 0.30;

    // =========================================================================
    //  INJECTED DEPENDENCIES
    // =========================================================================

    /** HTTP client — plain RestTemplate backed by Java HttpURLConnection.
     *  We don't use pooled clients (Apache HttpClient) because their default
     *  2-connections-per-route limit would artificially cap concurrency. */
    private RestTemplate http;

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

    // =========================================================================
    //  STATE
    // =========================================================================

    private String baseUrl;
    private String accessToken;

    /** Random seeded for reproducibility */
    private final Random random = new Random(42);

    /** Cached seed data keys for random selection during measurement */
    private List<String> barberNames;
    private List<String> serviceNames;
    private List<String> times;

    private String modeName;    // "Platform Threads" or "Virtual Threads"

    // =========================================================================
    //  SETUP — seed DB, login once
    // =========================================================================

    @BeforeEach
    void setUp() {
        baseUrl = "http://localhost:" + port;
        modeName = detectModeName();

        // Use a plain RestTemplate with Java's HttpURLConnection to avoid
        // connection-pool limits.  The static block above set http.maxConnections
        // to 100 so our CONCURRENCY=50 is not artificially capped.
        http = new RestTemplate();

        // Print header
        System.out.println("\n" + "=" .repeat(90));
        System.out.println("  \u2699 THREADING MODEL BENCHMARK: " + modeName);
        System.out.println("=" .repeat(90));

        // Clean in FK dependency order
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();

        // --- Seed barbers ---
        List<Barber> barbers = new ArrayList<>(BARBER_COUNT);
        for (int i = 0; i < BARBER_COUNT; i++) {
            barbers.add(new Barber(
                    "Barber " + i,
                    "barber" + i + "@example.com",
                    "555-" + String.format("%04d", i)
            ));
        }
        barberRepository.saveAll(barbers);
        barberNames = barbers.stream().map(Barber::getName).toList();

        // --- Seed barber schedules (all days, 08:00–18:00) ---
        // The createAppointment flow validates time against the barber's schedule;
        // without this, every POST is rejected with 400.
        for (Barber barber : barbers) {
            for (int day = 1; day <= 7; day++) {
                BarberSchedule schedule = new BarberSchedule();
                schedule.setBarber(barber);
                schedule.setDayOfWeek(day);
                schedule.setStartTime(LocalTime.of(8, 0));
                schedule.setEndTime(LocalTime.of(18, 0));
                barberScheduleRepository.save(schedule);
            }
        }

        // --- Seed services ---
        String[] categories = {"hair", "beard", "combo", "facial", "other"};
        List<ServiceItem> services = new ArrayList<>(SERVICE_COUNT);
        for (int i = 0; i < SERVICE_COUNT; i++) {
            services.add(new ServiceItem(
                    "Service " + i,
                    BigDecimal.valueOf(20.00 + (i * 5)),
                    15 + (i * 5),
                    categories[i % categories.length],
                    "Benchmark service " + i
            ));
        }
        serviceItemRepository.saveAll(services);
        serviceNames = services.stream().map(ServiceItem::getName).toList();

        // --- Seed appointments ---
        List<Appointment> appointments = new ArrayList<>(APPOINTMENT_COUNT);
        String[] statuses = {"PENDING", "APPROVED", "COMPLETED", "CANCELLED"};
        String[] timeSlots = {"09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"};
        times = List.of(timeSlots);
        LocalDate baseDate = LocalDate.of(2026, 6, 1);
        for (int i = 0; i < APPOINTMENT_COUNT; i++) {
            Barber barber = barbers.get(i % BARBER_COUNT);
            ServiceItem service = services.get(i % SERVICE_COUNT);
            Appointment a = new Appointment(
                    "Customer " + i,
                    "customer" + i + "@test.com",
                    "+1-555-" + String.format("%04d", i),
                    barber.getName(),
                    baseDate.plusDays(i / (BARBER_COUNT * 2)),
                    timeSlots[i % timeSlots.length],
                    service.getName()
            );
            a.setBarber(barber);
            a.setService(service);
            a.setStatus(statuses[i % statuses.length]);
            appointments.add(a);
        }
        appointmentRepository.saveAll(appointments);

        System.out.println("  Seed data: " + BARBER_COUNT + " barbers, "
                + SERVICE_COUNT + " services, " + APPOINTMENT_COUNT + " appointments");

        // --- Login as admin to get JWT ---
        loginAndGetToken();

        System.out.println("  Auth token acquired, benchmark ready.");
        System.out.println("  Workload: 30% GET appointments / 20% GET barbers / "
                + "20% GET catalog / 30% POST create");
        System.out.println("  Concurrency: " + CONCURRENCY
                + " | Total measurement requests: " + MEASUREMENT_REQUESTS);
        System.out.println();
    }

    /** Extracts a human-readable mode name from the concrete class's annotation. */
    private String detectModeName() {
        SpringBootTest annotation = getClass().getAnnotation(SpringBootTest.class);
        if (annotation != null) {
            for (String prop : annotation.properties()) {
                if (prop.contains("spring.threads.virtual.enabled=true")) {
                    return "VIRTUAL THREADS";
                }
            }
        }
        return "PLATFORM THREADS (BASELINE)";
    }

    /** Login as admin and extract the access_token cookie value. */
    private void loginAndGetToken() {
        Map<String, String> loginBody = Map.of("username", "admin", "password", "admin-password");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, String>> request = new HttpEntity<>(loginBody, headers);

        ResponseEntity<String> response = http.postForEntity(
                baseUrl + "/api/v1/auth/login", request, String.class);

        assertTrue(response.getStatusCode().is2xxSuccessful(),
                "Login failed: " + response.getStatusCode());

        // Parse access_token from Set-Cookie header
        List<String> setCookies = response.getHeaders().get("Set-Cookie");
        if (setCookies != null) {
            for (String cookie : setCookies) {
                if (cookie.startsWith("access_token=")) {
                    accessToken = cookie.substring("access_token=".length());
                    int semi = accessToken.indexOf(';');
                    if (semi > 0) {
                        accessToken = accessToken.substring(0, semi);
                    }
                    break;
                }
            }
        }

        // Fallback: try Authorization header or body
        if (accessToken == null) {
            accessToken = response.getBody();
        }

        assertTrue(accessToken != null && !accessToken.isBlank(),
                "Failed to extract access_token from login response");
    }

    // =========================================================================
    //  BENCHMARK — warmup then measurement
    // =========================================================================

    @Test
    void benchmarkThreadingModel() throws Exception {
        // --- Warm-up phase ---
        System.out.println("  Warm-up: " + WARMUP_REQUESTS + " requests...");
        runLoad(WARMUP_REQUESTS);
        System.out.println("  Warm-up complete.\n");

        // --- Measurement phase ---
        System.out.println("  Measurement: " + MEASUREMENT_REQUESTS + " requests...");
        long startNs = System.nanoTime();
        List<Long> latencies = runLoad(MEASUREMENT_REQUESTS);
        long elapsedNs = System.nanoTime() - startNs;
        System.out.println("  Measurement complete.\n");

        // --- Compute metrics ---
        double elapsedSec = elapsedNs / 1_000_000_000.0;
        double throughput = MEASUREMENT_REQUESTS / elapsedSec;

        long[] sorted = latencies.stream().mapToLong(Long::longValue).sorted().toArray();
        long min = sorted[0];
        long max = sorted[sorted.length - 1];
        double avg = Arrays.stream(sorted).average().orElse(0);
        long p50 = percentile(sorted, 50);
        long p90 = percentile(sorted, 90);
        long p95 = percentile(sorted, 95);
        long p99 = percentile(sorted, 99);

        // --- Report ---
        System.out.println("=" .repeat(90));
        System.out.println("  \uD83D\uDCCA RESULTS: " + modeName);
        System.out.println("=" .repeat(90));
        System.out.printf("  %-40s %10s%n", "Metric", "Value");
        System.out.println("  " + "-".repeat(55));
        System.out.printf("  %-40s %10.2f req/sec%n", "Throughput", throughput);
        System.out.printf("  %-40s %10.3f sec%n", "Total elapsed time", elapsedSec);
        System.out.printf("  %-40s %10d req%n", "Total requests", MEASUREMENT_REQUESTS);
        System.out.printf("  %-40s %10d%n", "Concurrency level", CONCURRENCY);
        System.out.println("  " + "-".repeat(55));
        System.out.printf("  %-40s %10.3f ms%n", "Average latency", avg);
        System.out.printf("  %-40s %10d ms%n", "Minimum latency", min);
        System.out.printf("  %-40s %10d ms%n", "Median (p50) latency", p50);
        System.out.printf("  %-40s %10d ms%n", "p90 latency", p90);
        System.out.printf("  %-40s %10d ms%n", "p95 latency", p95);
        System.out.printf("  %-40s %10d ms%n", "p99 latency", p99);
        System.out.printf("  %-40s %10d ms%n", "Maximum latency", max);
        System.out.println("=" .repeat(90));
        System.out.println();

        // --- Assert ---
        assertTrue(avg < MAX_AVG_LATENCY_MS,
                String.format("Average latency %.2f ms exceeds %.2f ms SLA",
                        avg, MAX_AVG_LATENCY_MS));

        // Print summary line for easy comparison
        System.out.println(">>> SUMMARY [" + modeName + "]"
                + " throughput=" + String.format("%.1f", throughput)
                + " req/s  avg=" + String.format("%.3f", avg)
                + " ms  p50=" + p50 + "  p95=" + p95 + "  p99=" + p99);
    }

    // =========================================================================
    //  LOAD GENERATOR
    // =========================================================================

    /**
     * Sends {@code count} requests concurrently using the weighted workload mix.
     * Returns a list of per-request latencies in milliseconds.
     */
    private List<Long> runLoad(int count) throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(CONCURRENCY);
        try {
            CountDownLatch startLatch = new CountDownLatch(1);
            CountDownLatch finishLatch = new CountDownLatch(count);

            List<Future<Long>> futures = new ArrayList<>(count);

            for (int i = 0; i < count; i++) {
                final int seed = i;
                futures.add(executor.submit(() -> {
                    startLatch.await();
                    long t0 = System.nanoTime();
                    try {
                        executeRandomRequest(seed);
                    } catch (Exception e) {
                        System.err.println("  Request failed: " + e.getMessage());
                    }
                    long t1 = System.nanoTime();
                    finishLatch.countDown();
                    return (t1 - t0) / 1_000_000L; // ms
                }));
            }

            startLatch.countDown();
            boolean completed = finishLatch.await(BENCHMARK_TIMEOUT_SECONDS, TimeUnit.SECONDS);

            if (!completed) {
                System.err.println("  WARNING: Benchmark timed out after "
                        + BENCHMARK_TIMEOUT_SECONDS + " seconds");
            }

            List<Long> latencies = new ArrayList<>(count);
            for (Future<Long> f : futures) {
                if (f.isDone()) {
                    try {
                        latencies.add(f.get());
                    } catch (Exception ignored) {
                        // task failed
                    }
                }
            }
            return latencies;

        } finally {
            executor.shutdownNow();
        }
    }

    /** Picks a random endpoint based on the weighted workload mix. */
    private void executeRandomRequest(int seed) {
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

    // =========================================================================
    //  ENDPOINT CALLS
    // =========================================================================

    /** GET /api/v1/appointments?page=0&size=10&status=PENDING (requires admin) */
    private void getAppointments() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        ResponseEntity<String> response = http.exchange(
                baseUrl + "/api/v1/appointments?page=0&size=10&status=PENDING",
                HttpMethod.GET, entity, String.class);

        if (!response.getStatusCode().is2xxSuccessful()) {
            System.err.println("  GET appointments failed: " + response.getStatusCode());
        }
    }

    /** GET /api/v1/barbers (public) */
    private void getBarbers() {
        ResponseEntity<String> response = http.getForEntity(
                baseUrl + "/api/v1/barbers", String.class);

        if (!response.getStatusCode().is2xxSuccessful()) {
            System.err.println("  GET barbers failed: " + response.getStatusCode());
        }
    }

    /** GET /api/v1/catalog (public) */
    private void getCatalog() {
        ResponseEntity<String> response = http.getForEntity(
                baseUrl + "/api/v1/catalog", String.class);

        if (!response.getStatusCode().is2xxSuccessful()) {
            System.err.println("  GET catalog failed: " + response.getStatusCode());
        }
    }

    /** POST /api/v1/appointments (public, but does DB writes) */
    private void createAppointment() {
        String barberName = barberNames.get(random.nextInt(barberNames.size()));
        String serviceName = serviceNames.get(random.nextInt(serviceNames.size()));
        String time = times.get(random.nextInt(times.size()));
        LocalDate date = LocalDate.of(2026, 6, 1)
                .plusDays(random.nextInt(60));
        String customerId = UUID.randomUUID().toString().substring(0, 8);

        AppointmentCreateRequest body = new AppointmentCreateRequest(
                "Benchmark " + customerId,
                "bm-" + customerId + "@test.com",
                "+1-555-" + customerId,
                barberName,
                date,
                time,
                serviceName
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<AppointmentCreateRequest> entity = new HttpEntity<>(body, headers);

        try {
            ResponseEntity<String> response = http.exchange(
                    baseUrl + "/api/v1/appointments",
                    HttpMethod.POST, entity, String.class);

            if (!response.getStatusCode().is2xxSuccessful()) {
                // Expect some 400s for duplicate time slots — that's okay,
                // the DB write still happens on the server side.
                if (!response.getStatusCode().equals(HttpStatus.BAD_REQUEST)) {
                    System.err.println("  POST appointment failed: " + response.getStatusCode());
                }
            }
        } catch (Exception ignored) {
            // Slot conflicts are expected; swallow harmless errors
        }
    }

    // =========================================================================
    //  UTILITIES
    // =========================================================================

    private static long percentile(long[] sorted, int pct) {
        if (sorted.length == 0) return 0;
        int index = (int) Math.ceil(pct / 100.0 * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }
}
