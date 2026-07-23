package com.example.taskflow.benchmark;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.appointment.AppointmentResponse;
import com.example.taskflow.appointment.Barber;
import com.example.taskflow.appointment.BarberRepository;
import com.example.taskflow.appointment.BarberScheduleRepository;
import com.example.taskflow.appointment.BarberTimeOffRepository;
import com.example.taskflow.auth.TestSecurityConfig;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemRepository;
import com.example.taskflow.catalog.ServiceItemResponse;
import com.example.taskflow.review.ReviewRepository;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GC COMPARISON BENCHMARK: G1GC vs ZGC ON ALLOCATION-HEAVY PATHS
 * <p>
 * The earlier GC benchmark (JVM & Runtime Layer, §1) validated G1GC vs ParallelGC
 * on the BCrypt-bound /login path, where allocations are minimal. This benchmark
 * targets allocation-heavy REST endpoints — large DTO list mapping, JSON
 * serialization, and entity-to-record conversion — where GC behavior dominates.
 * <p>
 * Run with G1GC:
 *   JAVA_TOOL_OPTIONS="-XX:+UseG1GC" ./gradlew benchmarkTest --tests *GcComparison*
 * <p>
 * Run with Generational ZGC:
 *   JAVA_TOOL_OPTIONS="-XX:+UseZGC -XX:+ZGenerational" ./gradlew benchmarkTest --tests *GcComparison*
 */
@Tag("benchmark")
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "app.stats.cache.ttl=0",
        "spring.datasource.hikari.maximum-pool-size=10",
})
@Import(TestSecurityConfig.class)
class GcComparisonBenchmarkTest {

    // -----------------------------------------------------------------------
    //  DATA VOLUME — 5,000 appointments + 100 barbers + 50 services
    //  Realistic for a busy multi-barber shop over several months.
    // -----------------------------------------------------------------------
    private static final int BARBER_COUNT = 100;
    private static final int SERVICE_COUNT = 50;
    private static final int APPOINTMENT_COUNT = 5_000;
    private static final int WARMUP_ITERATIONS = 5;
    private static final int MEASUREMENT_ITERATIONS = 10;

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

    // Jackson 3 ObjectMapper for JSON serialization benchmarks.
    // Created manually (not autowired) to avoid classpath ambiguity
    // between Jackson 2.x (com.fasterxml) and Jackson 3.x (tools.jackson).
    private final ObjectMapper objectMapper = new ObjectMapper();

    // GC monitoring beans
    private List<GarbageCollectorMXBean> gcBeans;
    private List<Barber> barbers;
    private List<ServiceItem> services;

    // -----------------------------------------------------------------------
    //  SETUP
    // -----------------------------------------------------------------------

    @BeforeEach
    void setUp() {
        gcBeans = ManagementFactory.getGarbageCollectorMXBeans();

        // Delete in FK dependency order
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();

        // Seed barbers
        barbers = new ArrayList<>(BARBER_COUNT);
        for (int i = 0; i < BARBER_COUNT; i++) {
            barbers.add(new Barber(
                    "Barber " + i,
                    "barber" + i + "@example.com",
                    "555-" + String.format("%04d", i)
            ));
        }
        barberRepository.saveAll(barbers);

        // Seed services
        services = new ArrayList<>(SERVICE_COUNT);
        String[] categories = {"hair", "beard", "combo", "facial", "other"};
        for (int i = 0; i < SERVICE_COUNT; i++) {
            services.add(new ServiceItem(
                    "Service " + i,
                    BigDecimal.valueOf(15.00 + (i % 85)),
                    15 + (i % 60),
                    categories[i % categories.length],
                    "Description for service " + i + " — a full-service offering"
            ));
        }
        serviceItemRepository.saveAll(services);

        // Seed appointments — spread across barbers and services for realistic joins
        List<Appointment> appointments = new ArrayList<>(APPOINTMENT_COUNT);
        LocalDate baseDate = LocalDate.of(2026, 1, 1);
        String[] statuses = {"PENDING", "APPROVED", "COMPLETED", "CANCELLED"};
        String[] times = {"09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"};
        for (int i = 0; i < APPOINTMENT_COUNT; i++) {
            Barber barber = barbers.get(i % BARBER_COUNT);
            ServiceItem service = services.get(i % SERVICE_COUNT);
            Appointment a = new Appointment(
                    "Customer " + i,
                    "customer" + i + "@example.com",
                    "+1-555-" + String.format("%04d", i),
                    barber.getName(),
                    baseDate.plusDays(i / (BARBER_COUNT * 2)),
                    times[i % times.length],
                    service.getName()
            );
            a.setBarber(barber);
            a.setService(service);
            a.setStatus(statuses[i % statuses.length]);
            appointments.add(a);
        }
        appointmentRepository.saveAll(appointments);
    }

    // -----------------------------------------------------------------------
    //  GC IDENTIFICATION
    // -----------------------------------------------------------------------

    @Test
    void identifyGarbageCollector() {
        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  ACTIVE GARBAGE COLLECTOR IDENTIFICATION");
        System.out.println("=" .repeat(80));

        // Print JVM GC info via runtime MXBean
        for (var pool : ManagementFactory.getMemoryPoolMXBeans()) {
            String name = pool.getName();
            // Only print GC-related pools
            if (name.contains("Heap") || name.contains("Young") || name.contains("Old") || name.contains("Eden") || name.contains("Survivor") || name.contains("Tenured") || name.contains("ZHeap")) {
                System.out.printf("  Memory pool: %s (%s)%n", name, pool.getType());
            }
        }

        String activeGcName = "unknown";
        for (var bean : gcBeans) {
            System.out.printf("  GC: %s (collections: %d, time: %d ms)%n",
                    bean.getName(), bean.getCollectionCount(), bean.getCollectionTime());
            if (bean.getCollectionCount() > 0) {
                activeGcName = bean.getName();
            }
        }

        // Detect GC from memory pool names
        for (var pool : ManagementFactory.getMemoryPoolMXBeans()) {
            if (pool.getName().contains("ZHeap")) {
                try {
                    var server = ManagementFactory.getPlatformMBeanServer();
                    var on = javax.management.ObjectName.getInstance("java.lang:type=GarbageCollector,name=ZGC");
                    Object val = server.getAttribute(on, "Generational");
                    activeGcName = "ZGC (Generational: " + ("true".equals(val.toString()) ? "yes" : "no") + ")";
                } catch (Exception e) {
                    activeGcName = "ZGC";
                }
                break;
            }
        }

        System.out.println("\n  >>> ACTIVE GC: " + activeGcName + "\n");
    }

    // -----------------------------------------------------------------------
    //  BENCHMARK 1: APPOINTMENT LIST — ENTITY LOAD + DTO MAPPING
    //  This is the most allocation-heavy path: loads 5K Appointments from the
    //  DB, iterates, and creates AppointmentResponse records.
    // -----------------------------------------------------------------------

    @Test
    void benchmarkAppointmentListWithMapping() {
        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  APPOINTMENT LIST: ENTITY LOAD + DTO MAPPING");
        System.out.println("  Data volume: " + APPOINTMENT_COUNT + " rows");
        System.out.println("=" .repeat(80));

        // --- Warm up ---
        GCStats warmupGc = new GCStats(gcBeans);
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            loadAndMapAppointments();
        }
        warmupGc.snapshot("Warm-up");

        // --- Measure ---
        GCStats measurementGc = new GCStats(gcBeans);
        long totalNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            totalNs += measureNanos(this::loadAndMapAppointments);
        }
        measurementGc.snapshot("Measurement");

        double avgMs = (totalNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;
        double throughput = 1000.0 / avgMs;

        reportResults("Entity load + DTO map", APPOINTMENT_COUNT, avgMs, throughput,
                warmupGc, measurementGc);
    }

    // -----------------------------------------------------------------------
    //  BENCHMARK 2: JSON SERIALIZATION
    //  Serializes the full appointment list to JSON — this exercises Jackson's
    //  allocation patterns (byte buffers, String building, token generation).
    // -----------------------------------------------------------------------

    @Test
    void benchmarkJsonSerialization() throws Exception {
        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  JSON SERIALIZATION: APPOINTMENT RESPONSE LIST");
        System.out.println("  Data volume: " + APPOINTMENT_COUNT + " items");
        System.out.println("=" .repeat(80));

        // Pre-load the data once (not measured)
        List<AppointmentResponse> responses = loadAndMapAppointments();

        // --- Warm up ---
        GCStats warmupGc = new GCStats(gcBeans);
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            objectMapper.writeValueAsString(responses);
        }
        warmupGc.snapshot("Warm-up");

        // --- Measure ---
        GCStats measurementGc = new GCStats(gcBeans);
        long totalNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            totalNs += measureNanos(() -> {
                try {
                    objectMapper.writeValueAsString(responses);
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });
        }
        measurementGc.snapshot("Measurement");

        double avgMs = (totalNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;
        double throughput = 1000.0 / avgMs;

        reportResults("JSON serialization (Jackson)", APPOINTMENT_COUNT, avgMs, throughput,
                warmupGc, measurementGc);
    }

    // -----------------------------------------------------------------------
    //  BENCHMARK 3: COMBINED API-LIKE ENDPOINT
    //  Simulates a full REST endpoint: DB load → DTO mapping → JSON serialize.
    //  This is the most realistic comparison of what the JVM does under load.
    // -----------------------------------------------------------------------

    @Test
    void benchmarkCombinedApiEndpoint() throws Exception {
        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  COMBINED API ENDPOINT: DB READ → DTO MAP → JSON");
        System.out.println("  Data volume: " + APPOINTMENT_COUNT + " rows");
        System.out.println("=" .repeat(80));

        // --- Warm up ---
        GCStats warmupGc = new GCStats(gcBeans);
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            combinedApiCall();
        }
        warmupGc.snapshot("Warm-up");

        // --- Measure ---
        GCStats measurementGc = new GCStats(gcBeans);
        long totalNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            totalNs += measureNanos(() -> {
                try {
                    combinedApiCall();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });
        }
        measurementGc.snapshot("Measurement");

        double avgMs = (totalNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;
        double throughput = 1000.0 / avgMs;

        reportResults("Combined (DB→DTO→JSON)", APPOINTMENT_COUNT, avgMs, throughput,
                warmupGc, measurementGc);
    }

    // -----------------------------------------------------------------------
    //  BENCHMARK 4: LARGE DTO LIST CONSTRUCTION (SYNTHETIC ALLOCATION-HEAVY)
    //  Creates thousands of small DTO record objects in a tight loop — pure
    //  allocation pressure, no DB or I/O. This isolates the GC's allocation
    //  throughput and TLAB efficiency.
    // -----------------------------------------------------------------------

    @Test
    void benchmarkAllocationStress() {
        int allocationCount = 500_000;

        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  SYNTHETIC ALLOCATION STRESS: DTO CONSTRUCTION");
        System.out.println("  Objects created: " + allocationCount + " AppointmentResponse records");
        System.out.println("=" .repeat(80));

        // --- Warm up ---
        GCStats warmupGc = new GCStats(gcBeans);
        for (int i = 0; i < 3; i++) {
            allocateRecords(allocationCount / 10);
        }
        warmupGc.snapshot("Warm-up");

        // --- Measure ---
        GCStats measurementGc = new GCStats(gcBeans);
        long totalNs = 0;
        for (int i = 0; i < 5; i++) {
            totalNs += measureNanos(() -> allocateRecords(allocationCount));
        }
        measurementGc.snapshot("Measurement");

        double avgMs = (totalNs / 5.0) / 1_000_000.0;
        double throughputPerSec = (allocationCount * 1000.0) / avgMs;

        System.out.println();
        System.out.printf("  %-40s %12s %16s%n", "Metric", "Value", "Per Second");
        System.out.println("  " + "-".repeat(70));
        System.out.printf("  %-40s %12.3f ms %16s%n", "Avg over 5 runs", avgMs, "");
        System.out.printf("  %-40s %12s %16.0f%n", "Record allocation", "", throughputPerSec);

        System.out.println("\n  GC activity during measurement (" + measurementGc.name + "):");
        measurementGc.printDelta(warmupGc);
        System.out.println();
    }

    // -----------------------------------------------------------------------
    //  PRIVATE HELPERS
    // -----------------------------------------------------------------------

    /** Loads all appointments and maps to DTO records. */
    private List<AppointmentResponse> loadAndMapAppointments() {
        return appointmentRepository.findAll().stream()
                .map(AppointmentResponse::fromEntity)
                .toList();
    }

    /** Full API endpoint simulation: load → map → serialize to JSON. */
    private String combinedApiCall() throws Exception {
        List<AppointmentResponse> responses = loadAndMapAppointments();
        return objectMapper.writeValueAsString(responses);
    }

    /** Creates a large number of DTO records synthetically (no DB). */
    private List<AppointmentResponse> allocateRecords(int count) {
        List<AppointmentResponse> records = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            records.add(new AppointmentResponse(
                    (long) i,
                    java.util.UUID.randomUUID().toString(),
                    "Customer " + i,
                    "customer" + i + "@test.com",
                    "+1-555-" + i,
                    "Barber " + (i % 100),
                    LocalDate.of(2026, 1, 1).plusDays(i % 365),
                    String.format("%02d:00", i % 24),
                    "Service " + (i % 50),
                    "PENDING",
                    java.time.LocalDateTime.now(),
                    java.time.LocalDateTime.now()
            ));
        }
        return records;
    }

    /** Measures execution time of a task in nanoseconds. */
    private long measureNanos(Runnable task) {
        long start = System.nanoTime();
        task.run();
        return System.nanoTime() - start;
    }

    /** Prints benchmark results table. */
    private void reportResults(String label, int rowCount, double avgMs, double throughput,
                               GCStats warmup, GCStats measurement) {
        System.out.println();
        System.out.printf("  %-40s %12s %12s%n", "Metric", "Value", "");
        System.out.println("  " + "-".repeat(65));
        System.out.printf("  %-40s %12.3f ms%n", "Average execution time", avgMs);
        System.out.printf("  %-40s %12.1f ops/sec%n", "Throughput", throughput);
        System.out.printf("  %-40s %12d rows%n", "Row count", rowCount);

        System.out.println("\n  GC activity during measurement (" + measurement.name + "):");
        measurement.printDelta(warmup);

        // Summary line for easy parsing
        System.out.println();
        System.out.println("  >>> RESULT: " + label
                + "  avg= " + String.format("%.3f", avgMs)
                + " ms  throughput= " + String.format("%.1f", throughput)
                + " ops/sec");
        System.out.println();
    }

    // -----------------------------------------------------------------------
    //  GC STATS TRACKER
    //  Captures per-collection counts and cumulative pause time.
    // -----------------------------------------------------------------------

    static class GCStats {
        final String name;
        final long[] collectionCounts;
        final long[] collectionTimes;

        GCStats(List<GarbageCollectorMXBean> beans) {
            this.name = detectGcName(beans);
            this.collectionCounts = new long[beans.size()];
            this.collectionTimes = new long[beans.size()];
            for (int i = 0; i < beans.size(); i++) {
                collectionCounts[i] = beans.get(i).getCollectionCount();
                collectionTimes[i] = beans.get(i).getCollectionTime();
            }
        }

        void snapshot(String phase) {
            long totalPause = 0;
            long totalCount = 0;
            for (int i = 0; i < collectionCounts.length; i++) {
                var bean = ManagementFactory.getGarbageCollectorMXBeans().get(i);
                long newCount = bean.getCollectionCount() - collectionCounts[i];
                long newTime = bean.getCollectionTime() - collectionTimes[i];
                totalCount += newCount;
                totalPause += newTime;
            }
        }

        void printDelta(GCStats baseline) {
            long totalGcCount = 0;
            long totalGcTime = 0;
            var currentBeans = ManagementFactory.getGarbageCollectorMXBeans();
            for (int i = 0; i < currentBeans.size(); i++) {
                long count = currentBeans.get(i).getCollectionCount() - baseline.collectionCounts[i];
                long time = currentBeans.get(i).getCollectionTime() - baseline.collectionTimes[i];
                if (count > 0) {
                    System.out.printf("    %-30s %5d collections  %6d ms total%n",
                            currentBeans.get(i).getName(), count, time);
                    totalGcCount += count;
                    totalGcTime += time;
                }
            }
            if (totalGcCount > 0) {
                System.out.printf("    %-30s %5d collections  %6d ms total%n",
                        "TOTAL", totalGcCount, totalGcTime);
                System.out.printf("    %-30s %5s  %6.2f ms avg pause%n",
                        "Average pause", "", (double) totalGcTime / totalGcCount);
            } else {
                System.out.println("    No GC collections during this phase.");
            }
        }

        private static String detectGcName(List<GarbageCollectorMXBean> beans) {
            for (var bean : beans) {
                String name = bean.getName();
                if (name.contains("ZGC")) {
                    try {
                        var server = ManagementFactory.getPlatformMBeanServer();
                        var on = javax.management.ObjectName.getInstance("java.lang:type=GarbageCollector,name=" + name);
                        Object val = server.getAttribute(on, "Generational");
                        if ("true".equals(val.toString())) {
                            return "ZGC (Generational)";
                        }
                    } catch (Exception e) {
                        // ignore
                    }
                    return "ZGC";
                }
                if (name.contains("G1")) return "G1GC";
                if (name.contains("Parallel")) return "ParallelGC";
                if (name.contains("Shenandoah")) return "Shenandoah";
            }
            return "Unknown";
        }
    }
}
