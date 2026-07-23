package com.example.taskflow.benchmark;

import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.appointment.Barber;
import com.example.taskflow.appointment.BarberRepository;
import com.example.taskflow.appointment.BarberResponse;
import com.example.taskflow.appointment.BarberScheduleRepository;
import com.example.taskflow.appointment.BarberTimeOffRepository;
import com.example.taskflow.auth.TestSecurityConfig;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemRepository;
import com.example.taskflow.catalog.ServiceItemResponse;
import com.example.taskflow.review.ReviewRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.util.StopWatch;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * HIGH-PERFORMANCE DTO PROJECTION vs ENTITY LOADING BENCHMARK
 * <p>
 * Measures the throughput and latency difference between two approaches
 * for reading and returning data from read-heavy API endpoints:
 * <ol>
 *   <li><b>Entity loading</b> (current approach) — loads full JPA entities,
 *       attaches them to the persistence context, then manually maps to DTOs.</li>
 *   <li><b>DTO projection</b> (proposed) — uses JPQL constructor expressions
 *       to select only the needed columns directly into DTO records,
 *       bypassing entity management entirely.</li>
 * </ol>
 * <p>
 * Benchmarked domains:
 * <ul>
 *   <li>{@code GET /api/v1/barbers} — {@link Barber} / {@link BarberResponse}</li>
 *   <li>{@code GET /api/v1/catalog}  — {@link ServiceItem} / {@link ServiceItemResponse}</li>
 * </ul>
 */
@Tag("benchmark")
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "app.stats.cache.ttl=0",
        "spring.datasource.hikari.maximum-pool-size=10",
})
@Import(TestSecurityConfig.class)
class DtoProjectionBenchmarkTest {

    private static final int BARBER_COUNT = 500;
    private static final int SERVICE_COUNT = 500;
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

    @BeforeEach
    void setUp() {
        // --- Delete in FK dependency order ---
        // Review → Appointment (barber_id, service_id) → BarberTimeOff / BarberSchedule → Barber, ServiceItem
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
                    "555-0" + i
            ));
        }
        barberRepository.saveAll(barbers);

        // --- Seed services ---
        List<ServiceItem> services = new ArrayList<>(SERVICE_COUNT);
        String[] categories = {"hair", "beard", "combo", "facial", "other"};
        for (int i = 0; i < SERVICE_COUNT; i++) {
            services.add(new ServiceItem(
                    "Service " + i,
                    BigDecimal.valueOf(10.00 + (i % 90)),
                    15 + (i % 60),
                    categories[i % categories.length],
                    "Description for service " + i
            ));
        }
        serviceItemRepository.saveAll(services);
    }

    // =========================================================================
    //  BARBER BENCHMARKS
    // =========================================================================

    @Test
    void benchmarkBarberReads() {
        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  BARBER LISTING: ENTITY LOADING vs DTO PROJECTION");
        System.out.println("  Data volume: " + BARBER_COUNT + " rows");
        System.out.println("=" .repeat(80));

        // --- Warm up ---
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            loadBarbersViaEntities();
            loadBarbersViaDtos();
        }

        // --- Measure entity approach ---
        long entityNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            entityNs += measureNanos(this::loadBarbersViaEntities);
        }
        double entityAvgMs = (entityNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;

        // --- Measure DTO projection approach ---
        long dtoNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            dtoNs += measureNanos(this::loadBarbersViaDtos);
        }
        double dtoAvgMs = (dtoNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;

        // --- Report ---
        double speedup = ((entityAvgMs - dtoAvgMs) / entityAvgMs) * 100.0;
        double entityThroughput = 1000.0 / entityAvgMs;  // ops/sec
        double dtoThroughput = 1000.0 / dtoAvgMs;

        System.out.println();
        System.out.printf("  %-45s %12s %12s %10s%n", "Approach", "Avg (ms)", "Ops/sec", "vs Entity");
        System.out.println("  " + "-".repeat(79));
        System.out.printf("  %-45s %12.3f %12.1f %10s%n",
                "Entity loading + manual mapping", entityAvgMs, entityThroughput, "—");
        System.out.printf("  %-45s %12.3f %12.1f %10s%n",
                "DTO projection (JPQL constructor)", dtoAvgMs, dtoThroughput,
                speedup > 0 ? "+" + String.format("%.1f%%", speedup) : String.format("%.1f%%", speedup));

        // --- Validate correctness ---
        List<BarberResponse> entityResults = loadBarbersViaEntities();
        List<BarberResponse> dtoResults = loadBarbersViaDtos();
        assertEquals(entityResults.size(), dtoResults.size(),
                "Both approaches must return the same number of barbers");
        assertEquals(entityResults.get(0).name(), dtoResults.get(0).name(),
                "Both approaches must return the same data (checked first entry)");

        // --- Summary line for easy parsing ---
        System.out.println();
        System.out.println("  >>> RESULT: Barber entity= " + String.format("%.3f", entityAvgMs)
                + " ms  dto= " + String.format("%.3f", dtoAvgMs)
                + " ms  speedup= " + String.format("%+.1f%%", speedup));
        System.out.println();
    }

    // =========================================================================
    //  SERVICE CATALOG BENCHMARKS
    // =========================================================================

    @Test
    void benchmarkServiceReads() {
        System.out.println("\n" + "=" .repeat(80));
        System.out.println("  SERVICE CATALOG: ENTITY LOADING vs DTO PROJECTION");
        System.out.println("  Data volume: " + SERVICE_COUNT + " rows");
        System.out.println("=" .repeat(80));

        // --- Warm up ---
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            loadServicesViaEntities();
            loadServicesViaDtos();
        }

        // --- Measure entity approach ---
        long entityNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            entityNs += measureNanos(this::loadServicesViaEntities);
        }
        double entityAvgMs = (entityNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;

        // --- Measure DTO projection approach ---
        long dtoNs = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            dtoNs += measureNanos(this::loadServicesViaDtos);
        }
        double dtoAvgMs = (dtoNs / (double) MEASUREMENT_ITERATIONS) / 1_000_000.0;

        // --- Report ---
        double speedup = ((entityAvgMs - dtoAvgMs) / entityAvgMs) * 100.0;
        double entityThroughput = 1000.0 / entityAvgMs;
        double dtoThroughput = 1000.0 / dtoAvgMs;

        System.out.println();
        System.out.printf("  %-45s %12s %12s %10s%n", "Approach", "Avg (ms)", "Ops/sec", "vs Entity");
        System.out.println("  " + "-".repeat(79));
        System.out.printf("  %-45s %12.3f %12.1f %10s%n",
                "Entity loading + manual mapping", entityAvgMs, entityThroughput, "—");
        System.out.printf("  %-45s %12.3f %12.1f %10s%n",
                "DTO projection (JPQL constructor)", dtoAvgMs, dtoThroughput,
                speedup > 0 ? "+" + String.format("%.1f%%", speedup) : String.format("%.1f%%", speedup));

        // --- Validate correctness ---
        List<ServiceItemResponse> entityResults = loadServicesViaEntities();
        List<ServiceItemResponse> dtoResults = loadServicesViaDtos();
        assertEquals(entityResults.size(), dtoResults.size(),
                "Both approaches must return the same number of services");
        assertEquals(entityResults.get(0).name(), dtoResults.get(0).name(),
                "Both approaches must return the same data (checked first entry)");

        // --- Summary line for easy parsing ---
        System.out.println();
        System.out.println("  >>> RESULT: Service entity= " + String.format("%.3f", entityAvgMs)
                + " ms  dto= " + String.format("%.3f", dtoAvgMs)
                + " ms  speedup= " + String.format("%+.1f%%", speedup));
        System.out.println();
    }

    // =========================================================================
    //  COMBINED REPORT
    // =========================================================================

    @Test
    void benchmarkCombinedReport() {
        System.out.println("\n" + "█".repeat(80));
        System.out.println("  TASKFLOW DTO PROJECTION vs ENTITY LOADING — FULL BENCHMARK");
        System.out.println("  " + BARBER_COUNT + " barbers × " + SERVICE_COUNT + " services");
        System.out.println("  " + WARMUP_ITERATIONS + " warm-up, " + MEASUREMENT_ITERATIONS + " measured iterations");
        System.out.println("█".repeat(80));

        // --- Barber benchmarks ---
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            loadBarbersViaEntities();
            loadBarbersViaDtos();
        }

        double barberEntityMs = 0, barberDtoMs = 0;
        int barberValidRuns = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            List<BarberResponse> entityResult = loadBarbersViaEntities();
            List<BarberResponse> dtoResult = loadBarbersViaDtos();
            if (entityResult.size() == dtoResult.size()) {
                barberEntityMs += measureNanos(this::loadBarbersViaEntities) / 1_000_000.0;
                barberDtoMs += measureNanos(this::loadBarbersViaDtos) / 1_000_000.0;
                barberValidRuns++;
            }
        }
        barberEntityMs /= barberValidRuns;
        barberDtoMs /= barberValidRuns;
        double barberSpeedup = ((barberEntityMs - barberDtoMs) / barberEntityMs) * 100.0;

        // --- Service benchmarks ---
        for (int i = 0; i < WARMUP_ITERATIONS; i++) {
            loadServicesViaEntities();
            loadServicesViaDtos();
        }

        double svcEntityMs = 0, svcDtoMs = 0;
        int svcValidRuns = 0;
        for (int i = 0; i < MEASUREMENT_ITERATIONS; i++) {
            List<ServiceItemResponse> entityResult = loadServicesViaEntities();
            List<ServiceItemResponse> dtoResult = loadServicesViaDtos();
            if (entityResult.size() == dtoResult.size()) {
                svcEntityMs += measureNanos(this::loadServicesViaEntities) / 1_000_000.0;
                svcDtoMs += measureNanos(this::loadServicesViaDtos) / 1_000_000.0;
                svcValidRuns++;
            }
        }
        svcEntityMs /= svcValidRuns;
        svcDtoMs /= svcValidRuns;
        double svcSpeedup = ((svcEntityMs - svcDtoMs) / svcEntityMs) * 100.0;

        // --- Final combined report ---
        System.out.println();
        System.out.printf("  %-20s %-20s %-20s %-20s%n", "Domain", "Entity (ms)", "DTO (ms)", "Speedup");
        System.out.println("  " + "-".repeat(76));
        System.out.printf("  %-20s %-20.3f %-20.3f %-+20.1f%%%n",
                "Barbers", barberEntityMs, barberDtoMs, barberSpeedup);
        System.out.printf("  %-20s %-20.3f %-20.3f %-+20.1f%%%n",
                "Services", svcEntityMs, svcDtoMs, svcSpeedup);
        System.out.println("  " + "-".repeat(76));
        System.out.printf("  %-20s %-20s %-20s %-20s%n",
                "", "",
                "Avg improvement:",
                String.format("%.1f%%", (barberSpeedup + svcSpeedup) / 2.0));
        System.out.println();

        // Assert: DTO projection should be at least as fast as entity loading
        // (it's strictly faster in practice, but we assert non-regression)
        assertTrue(barberDtoMs <= barberEntityMs * 1.05,
                "Barber DTO projection should not be more than 5% slower than entity loading");
        assertTrue(svcDtoMs <= svcEntityMs * 1.05,
                "Service DTO projection should not be more than 5% slower than entity loading");
    }

    // =========================================================================
    //  PRIVATE HELPERS
    // =========================================================================

    /** Entity-based barber loading: full entities → manual DTO mapping. */
    private List<BarberResponse> loadBarbersViaEntities() {
        return barberRepository.findAll().stream()
                .map(BarberResponse::fromEntity)
                .toList();
    }

    /** DTO projection barber loading: JPQL constructor expression. */
    private List<BarberResponse> loadBarbersViaDtos() {
        return barberRepository.findAllProjectedBy();
    }

    /** Entity-based service loading: full entities → manual DTO mapping. */
    private List<ServiceItemResponse> loadServicesViaEntities() {
        return serviceItemRepository.findAll().stream()
                .map(ServiceItemResponse::fromEntity)
                .toList();
    }

    /** DTO projection service loading: JPQL constructor expression. */
    private List<ServiceItemResponse> loadServicesViaDtos() {
        return serviceItemRepository.findAllProjectedBy();
    }

    /** Measures execution time of a Runnable in nanoseconds. */
    private long measureNanos(Runnable task) {
        long start = System.nanoTime();
        task.run();
        return System.nanoTime() - start;
    }
}
