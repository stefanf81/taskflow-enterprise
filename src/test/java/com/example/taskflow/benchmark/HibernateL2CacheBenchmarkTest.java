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
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.TypedQuery;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Import;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * HIBERNATE 2ND-LEVEL CACHE vs SPRING @Cacheable vs NO CACHE BENCHMARK
 * <p>
 * Compares four caching strategies for read-mostly reference data across
 * the two key listing endpoints ({@code GET /api/v1/barbers},
 * {@code GET /api/v1/catalog}) and single-entity lookups
 * ({@code findById}):
 * <ol>
 *   <li><b>No Cache (Baseline)</b> — JPQL DTO projection, DB round-trip every call.
 *       Current production behavior for catalog services.</li>
 *   <li><b>Spring @Cacheable</b> — Application-level concurrent-map cache stores the
 *       pre-mapped DTO list. Zero DB, zero mapping on hit.</li>
 *   <li><b>Hibernate L2 + Query Cache</b> — JPQL DTO projection with Hibernate's
 *       query cache and entity-level L2 cache enabled. Eliminates DB round-trips
 *       for list queries after the first call.</li>
 *   <li><b>Hibernate L2 Entity Cache</b> — Single-entity lookup by ID via
 *       {@code findById()}. After warmup, L2 cache returns the entity directly
 *       without any database interaction.</li>
 * </ol>
 * <p>
 * Data volume: 200 barbers × 200 services (moderate reference dataset).
 * Iterations: 2,000 warm-up, 10,000 measured per strategy.
 * <p>
 * <b>All Hibernate L2 cache configuration is scoped to this test's
 * properties.</b> Production continues using
 * {@code hibernate.cache.use_second_level_cache=false} (see
 * {@code application.properties}). The {@code @Cache(usage=READ_WRITE)}
 * entity annotations added in this change are harmless when L2 is disabled
 * — Hibernate simply ignores them.
 * <p>
 * JVM options (set via {@code JAVA_TOOL_OPTIONS}):
 * <pre>
 *   # G1GC (default on JDK 25):
 *   JAVA_TOOL_OPTIONS="" ./gradlew benchmarkTest --tests *HibernateL2*
 * <p>
 *   # Generational ZGC (JDK 25 has no -XX:+ZGenerational flag):
 *   JAVA_TOOL_OPTIONS="-XX:+UseZGC" ./gradlew benchmarkTest --tests *HibernateL2*
 * </pre>
 *
 * @see Barber
 * @see ServiceItem
 * @see com.example.taskflow.core.CacheConfig
 */
@Tag("benchmark")
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "spring.datasource.hikari.maximum-pool-size=10",
        "spring.cache.type=simple",
        "spring.jpa.properties.hibernate.cache.use_second_level_cache=true",
        "spring.jpa.properties.hibernate.cache.use_query_cache=true",
        "spring.jpa.properties.hibernate.cache.region.factory_class=jcache"
})
@Import(TestSecurityConfig.class)
class HibernateL2CacheBenchmarkTest {

    private static final int BARBER_COUNT = 200;
    private static final int SERVICE_COUNT = 200;
    private static final int WARMUP_ITERATIONS = 2_000;
    private static final int MEASUREMENT_ITERATIONS = 10_000;

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

    @Autowired
    private CacheManager cacheManager;

    @Autowired
    private EntityManagerFactory emf;

    @BeforeEach
    void setUp() {
        // Clear Hibernate L2 cache before each test to prevent cross-test pollution.
        // If L2 is not configured/enabled, this is a no-op.
        emf.getCache().evictAll();

        // Clear Spring application-level caches
        Cache barberCache = cacheManager.getCache("barbers");
        if (barberCache != null) {
            barberCache.clear();
        }
        Cache serviceCache = cacheManager.getCache("services");
        if (serviceCache != null) {
            serviceCache.clear();
        }

        // Delete in FK dependency order
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();

        // Seed barbers
        List<Barber> barbers = new ArrayList<>(BARBER_COUNT);
        for (int i = 0; i < BARBER_COUNT; i++) {
            barbers.add(new Barber(
                    "Barber " + i,
                    "barber" + i + "@example.com",
                    "555-0" + i
            ));
        }
        barberRepository.saveAll(barbers);

        // Seed services
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

    // =====================================================================
    //  STRATEGY 1: NO CACHE (BASELINE)
    //
    //  JPQL DTO projection — full DB query + DTO constructor mapping on
    //  every call. This matches the current production behavior for
    //  CatalogServiceImpl.getAllServices() and BarberController.
    // =====================================================================

    @Test
    void barbers_noCache() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ BARBERS LIST: NO CACHE (BASELINE)");
        System.out.println("  Data volume: " + BARBER_COUNT + " rows");
        System.out.println("  Method: barberRepository.findAllProjectedBy()");
        System.out.println("=".repeat(80));

        warmup(WARMUP_ITERATIONS, () -> barberRepository.findAllProjectedBy());
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS, () -> barberRepository.findAllProjectedBy());

        printResult("Barbers: No Cache (findAllProjectedBy)", BARBER_COUNT, result);
    }

    @Test
    void services_noCache() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ SERVICES CATALOG: NO CACHE (BASELINE)");
        System.out.println("  Data volume: " + SERVICE_COUNT + " rows");
        System.out.println("  Method: serviceItemRepository.findAllProjectedBy()");
        System.out.println("=".repeat(80));

        warmup(WARMUP_ITERATIONS, () -> serviceItemRepository.findAllProjectedBy());
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS, () -> serviceItemRepository.findAllProjectedBy());

        printResult("Services: No Cache (findAllProjectedBy)", SERVICE_COUNT, result);
    }

    // =====================================================================
    //  STRATEGY 2: SPRING @Cacheable (APPLICATION-LEVEL)
    //
    //  Pre-populated ConcurrentHashMap stores the DTO list directly.
    //  Each hit returns the pre-mapped DTO list — zero DB access, zero
    //  DTO constructor overhead, zero persistence context interaction.
    //  This is the theoretical fastest approach for read-only reference
    //  data.
    // =====================================================================

    @Test
    void barbers_springCacheable() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ BARBERS LIST: SPRING @Cacheable");
        System.out.println("  Data volume: " + BARBER_COUNT + " rows");
        System.out.println("  Cache store: ConcurrentHashMap (spring.cache.type=simple)");
        System.out.println("=".repeat(80));

        // Pre-populate the Spring cache once (cost not included in measurement)
        List<BarberResponse> dtoList = barberRepository.findAllProjectedBy();
        Cache cache = cacheManager.getCache("barbers");
        assertNotNull(cache, "barbers cache must be present");
        cache.put("all", dtoList);

        warmup(WARMUP_ITERATIONS, () -> cache.get("all", List.class));
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS, () -> cache.get("all", List.class));

        printResult("Barbers: Spring @Cacheable", BARBER_COUNT, result);
    }

    @Test
    void services_springCacheable() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ SERVICES CATALOG: SPRING @Cacheable");
        System.out.println("  Data volume: " + SERVICE_COUNT + " rows");
        System.out.println("  Cache store: ConcurrentHashMap (spring.cache.type=simple)");
        System.out.println("=".repeat(80));

        // Pre-populate the Spring cache once (cost not included in measurement)
        List<ServiceItemResponse> dtoList = serviceItemRepository.findAllProjectedBy();
        Cache cache = cacheManager.getCache("services");
        assertNotNull(cache, "services cache must be present");
        cache.put("all", dtoList);

        warmup(WARMUP_ITERATIONS, () -> cache.get("all", List.class));
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS, () -> cache.get("all", List.class));

        printResult("Services: Spring @Cacheable", SERVICE_COUNT, result);
    }

    // =====================================================================
    //  STRATEGY 3: HIBERNATE L2 + QUERY CACHE
    //
    //  JPQL DTO projection with query cache enabled. The first invocation
    //  runs the SQL query and populates both the query cache (result set)
    //  and entity cache (individual entity rows). All subsequent calls
    //  hit the query cache — no database round-trip occurs, though DTO
    //  constructor expressions ARE still evaluated by Hibernate on cache
    //  hit (see note below).
    //
    //  NOTE: For DTO projection queries with constructor expressions
    //  (SELECT new BarberResponse(...)), Hibernate stores the row-by-row
    //  scalar values in the query cache. On a cache hit, it re-evaluates
    //  the constructor expression from those cached values — which means
    //  the DTO record construction is still performed, just without the
    //  JDBC result-set traversal overhead.
    // =====================================================================

    private static final String BARBER_PROJECTION_JPQL = """
            SELECT new com.example.taskflow.appointment.BarberResponse(
                b.id, b.name, b.email, b.phone
            )
            FROM Barber b
            ORDER BY b.name
            """;

    private static final String SERVICE_PROJECTION_JPQL = """
            SELECT new com.example.taskflow.catalog.ServiceItemResponse(
                s.id, s.name, s.price, s.durationMinutes, s.category, s.description
            )
            FROM ServiceItem s
            ORDER BY s.name
            """;

    @Test
    void barbers_hibernateQueryCache() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ BARBERS LIST: HIBERNATE L2 + QUERY CACHE");
        System.out.println("  Data volume: " + BARBER_COUNT + " rows");
        System.out.println("  Query hint: org.hibernate.cacheable=true");
        System.out.println("  Region factory: jcache (Caffeine-backed)");
        System.out.println("=".repeat(80));

        // Warm the query/entity caches with one real DB query
        warmQueryCache(BARBER_PROJECTION_JPQL, BarberResponse.class);

        warmup(WARMUP_ITERATIONS, () -> runCachedQuery(BARBER_PROJECTION_JPQL, BarberResponse.class));
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS,
                () -> runCachedQuery(BARBER_PROJECTION_JPQL, BarberResponse.class));

        printResult("Barbers: Hibernate L2 + Query Cache", BARBER_COUNT, result);
    }

    @Test
    void services_hibernateQueryCache() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ SERVICES CATALOG: HIBERNATE L2 + QUERY CACHE");
        System.out.println("  Data volume: " + SERVICE_COUNT + " rows");
        System.out.println("  Query hint: org.hibernate.cacheable=true");
        System.out.println("  Region factory: jcache (Caffeine-backed)");
        System.out.println("=".repeat(80));

        // Warm the query/entity caches with one real DB query
        warmQueryCache(SERVICE_PROJECTION_JPQL, ServiceItemResponse.class);

        warmup(WARMUP_ITERATIONS, () -> runCachedQuery(SERVICE_PROJECTION_JPQL, ServiceItemResponse.class));
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS,
                () -> runCachedQuery(SERVICE_PROJECTION_JPQL, ServiceItemResponse.class));

        printResult("Services: Hibernate L2 + Query Cache", SERVICE_COUNT, result);
    }

    // =====================================================================
    //  STRATEGY 4: HIBERNATE L2 ENTITY CACHE (SINGLE LOOKUP BY ID)
    //
    //  findById() delegates to EntityManager.find(), which checks the L2
    //  entity cache before querying the database. After the first call
    //  loads the entity from the DB and populates the L2 cache, subsequent
    //  repeated lookups resolve entirely from the Caffeine-backed region
    //  — zero SQL, zero JDBC overhead, zero DTO mapping.
    //
    //  This is the most impactful use case for entity-level caching:
    //  repeated access to individual reference records (e.g. fetching a
    //  barber's name for a dropdown, displaying a service detail).
    // =====================================================================

    @Test
    void barberById_hibernateEntityCache() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ BARBER BY ID: HIBERNATE L2 ENTITY CACHE");
        System.out.println("  Entity: Barber(id=1)");
        System.out.println("  Method: barberRepository.findById(1L)");
        System.out.println("=".repeat(80));

        // Warm the L2 entity cache with one real DB load
        barberRepository.findById(1L);

        warmup(WARMUP_ITERATIONS, () -> barberRepository.findById(1L));
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS, () -> barberRepository.findById(1L));

        printResult("Barber by ID: Hibernate L2 Entity Cache", 1, result);
    }

    @Test
    void serviceById_hibernateEntityCache() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ SERVICE BY ID: HIBERNATE L2 ENTITY CACHE");
        System.out.println("  Entity: ServiceItem(id=1)");
        System.out.println("  Method: serviceItemRepository.findById(1L)");
        System.out.println("=".repeat(80));

        // Warm the L2 entity cache with one real DB load
        serviceItemRepository.findById(1L);

        warmup(WARMUP_ITERATIONS, () -> serviceItemRepository.findById(1L));
        BenchmarkResult result = measure(MEASUREMENT_ITERATIONS, () -> serviceItemRepository.findById(1L));

        printResult("Service by ID: Hibernate L2 Entity Cache", 1, result);
    }

    // =====================================================================
    //  PRIVATE HELPERS
    // =====================================================================

    /**
     * Executes a JPQL query once with {@code org.hibernate.cacheable=true}
     * to warm the Hibernate query cache and entity cache regions.
     */
    private <T> void warmQueryCache(String jpql, Class<T> resultClass) {
        EntityManager em = emf.createEntityManager();
        try {
            em.createQuery(jpql, resultClass)
                    .setHint("org.hibernate.cacheable", true)
                    .getResultList();
        } finally {
            em.close();
        }
    }

    /**
     * Runs a JPQL query with {@code org.hibernate.cacheable=true},
     * opening and closing an EntityManager per call to simulate
     * stateless request-scoped behavior (no first-level cache reuse).
     */
    private <T> List<T> runCachedQuery(String jpql, Class<T> resultClass) {
        EntityManager em = emf.createEntityManager();
        try {
            TypedQuery<T> query = em.createQuery(jpql, resultClass)
                    .setHint("org.hibernate.cacheable", true);
            return query.getResultList();
        } finally {
            em.close();
        }
    }

    /** Executes `iterations` repetitions of `task` for JVM warm-up. */
    private void warmup(int iterations, Runnable task) {
        for (int i = 0; i < iterations; i++) {
            task.run();
        }
    }

    /**
     * Measures total execution time of {@code iterations} repetitions.
     * Returns average latency in microseconds and throughput in ops/sec.
     */
    private BenchmarkResult measure(int iterations, Runnable task) {
        long startNs = System.nanoTime();
        for (int i = 0; i < iterations; i++) {
            task.run();
        }
        long totalNs = System.nanoTime() - startNs;
        double avgNs = (double) totalNs / iterations;
        double avgUs = avgNs / 1_000.0;
        double opsPerSec = 1_000_000_000.0 / avgNs;
        return new BenchmarkResult(avgUs, opsPerSec, totalNs, iterations);
    }

    /** Formats and prints a single benchmark result table. */
    private void printResult(String label, int rowCount, BenchmarkResult r) {
        System.out.println();
        System.out.printf("  %-50s %12s%n", "Metric", "Value");
        System.out.println("  " + "-".repeat(64));
        System.out.printf("  %-50s %12.3f µs%n", "Average execution time", r.avgUs);
        System.out.printf("  %-50s %12.1f ops/sec%n", "Throughput (operations/sec)", r.opsPerSec);
        if (r.avgUs < 1.0) {
            System.out.printf("  %-50s %12.3f ns%n", "Average execution time (ns)", r.avgUs * 1_000.0);
        }
        System.out.printf("  %-50s %12d rows%n", "Row count", rowCount);
        System.out.printf("  %-50s %12d iterations%n", "Measured iterations", r.iterations);

        System.out.println();
        System.out.println("  ═══ RESULT ═══");
        System.out.println("  " + label);
        System.out.printf("  avg= %8.3f µs  throughput= %10.1f ops/sec  rows= %d  iter= %d%n",
                r.avgUs, r.opsPerSec, rowCount, r.iterations);
        System.out.println();
    }

    /** Holds aggregate benchmark metrics. */
    private record BenchmarkResult(double avgUs, double opsPerSec, long totalNs, int iterations) {}
}
