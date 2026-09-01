package com.example.taskflow.benchmark;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Benchmark & correctness proof for P0-3: Lua-atomic rate limiter.
 *
 * <p>Old code did {@code INCR} + {@code EXPIRE} in two round-trips.
 * Crash between them leaks a key without TTL → permanent block.
 * Fix uses single {@code EVAL} Lua:
 * {@code local c=redis.call('incr',KEYS[1]); if c==1 then redis.call('pexpire',KEYS[1],ARGV[1]) end; return c}
 *
 * <p>Requires a running Redis at localhost:6379 (docker-compose redis or
 * {@code docker run -p 6379:6379 redis:8.10.1-alpine}).
 *
 * <p>Run:
 * <pre>{@code ./gradlew benchmarkTest --tests "*RateLimiterBenchmarkTest*"}</pre>
 */
@Tag("benchmark")
@SpringBootTest(properties = {
        "app.rate-limit.enabled=false",
        "spring.cache.type=simple",
        "spring.data.redis.host=localhost",
        "spring.data.redis.port=6379",
        "spring.data.redis.timeout=2000",
        "spring.jpa.properties.hibernate.cache.use_second_level_cache=false"
})
class RateLimiterBenchmarkTest {

    private static final int WARMUP = 2_000;
    private static final int MEASUREMENT = 10_000;
    private static final int CONCURRENCY = 50;
    private static final int BURST_PER_THREAD = 20;
    private static final long TTL_MILLIS = 60000;

    private static final DefaultRedisScript<Long> RATE_LIMIT_SCRIPT;
    static {
        String lua = "local c = redis.call('incr', KEYS[1]); "
                + "if c == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end; "
                + "return c";
        RATE_LIMIT_SCRIPT = new DefaultRedisScript<>();
        RATE_LIMIT_SCRIPT.setScriptText(lua);
        RATE_LIMIT_SCRIPT.setResultType(Long.class);
    }

    @Autowired
    private StringRedisTemplate redisTemplate;

    @BeforeEach
    void flush() {
        try {
            redisTemplate.getConnectionFactory().getConnection().serverCommands().flushAll();
        } catch (Exception e) {
            // If Redis not available, fail fast with clear message
            throw new IllegalStateException("Redis not available at localhost:6379 — start with `docker run -p 6379:6379 redis:8.10.1-alpine`", e);
        }
    }

    // -------------------------------------------------------------------------
    //  Helpers
    // -------------------------------------------------------------------------
    private Long incrTwoStep(String key) {
        Long c = redisTemplate.opsForValue().increment(key);
        if (c != null && c == 1) {
            redisTemplate.expire(key, java.time.Duration.ofMillis(TTL_MILLIS));
        }
        return c;
    }

    private Long incrLua(String key) {
        return redisTemplate.execute(RATE_LIMIT_SCRIPT, Collections.singletonList(key), String.valueOf(TTL_MILLIS));
    }

    private void warmup(int n, Runnable r) {
        for (int i = 0; i < n; i++) r.run();
    }

    private BenchmarkResult measure(int n, Runnable r) {
        long start = System.nanoTime();
        for (int i = 0; i < n; i++) r.run();
        long total = System.nanoTime() - start;
        double avgNs = (double) total / n;
        double avgUs = avgNs / 1000.0;
        double ops = 1_000_000_000.0 / avgNs;
        return new BenchmarkResult(avgUs, ops, total, n);
    }

    private void print(String label, BenchmarkResult r) {
        System.out.println();
        System.out.printf("  %-50s %12s%n", "Metric", "Value");
        System.out.println("  " + "-".repeat(64));
        System.out.printf("  %-50s %12.3f µs%n", "Average", r.avgUs);
        System.out.printf("  %-50s %12.1f ops/sec%n", "Throughput", r.opsPerSec);
        if (r.avgUs < 1.0) System.out.printf("  %-50s %12.0f ns%n", "Average (ns)", r.avgUs * 1000);
        System.out.println();
        System.out.println("  ═══ " + label + " ═══");
        System.out.printf("  avg=%.3f µs  ops=%.1f%n", r.avgUs, r.opsPerSec);
        System.out.println();
    }

    private record BenchmarkResult(double avgUs, double opsPerSec, long totalNs, int iterations) {}

    // -------------------------------------------------------------------------
    //  Benchmark: two-step vs Lua throughput
    // -------------------------------------------------------------------------
    @Test
    void benchmark_twoStep_vs_lua_throughput() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ RATE LIMITER THROUGHPUT: INCR+EXPIRE (2 RTT) vs LUA EVAL (1 RTT)");
        System.out.println("  Redis: localhost:6379 (docker: redis:8.10.1-alpine)");
        System.out.println("  Iterations: " + MEASUREMENT + "  warmup: " + WARMUP);
        System.out.println("=".repeat(80));

        // Two-step baseline: distinct keys to avoid key-reuse effects (each INCR starts at 1 → EXPIRE)
        warmup(WARMUP, () -> {
            String k = "bench:twostep:" + System.nanoTime();
            incrTwoStep(k);
            redisTemplate.delete(k);
        });
        BenchmarkResult twoStep = measure(MEASUREMENT, () -> {
            String k = "bench:twostep:" + System.nanoTime();
            incrTwoStep(k);
            redisTemplate.delete(k);
        });
        print("Two-step INCR+EXPIRE (old)", twoStep);

        // Lua
        warmup(WARMUP, () -> {
            String k = "bench:lua:" + System.nanoTime();
            incrLua(k);
            redisTemplate.delete(k);
        });
        BenchmarkResult lua = measure(MEASUREMENT, () -> {
            String k = "bench:lua:" + System.nanoTime();
            incrLua(k);
            redisTemplate.delete(k);
        });
        print("Lua EVAL INCR+PEXPIRE (P0-3 fix)", lua);

        double deltaUs = twoStep.avgUs - lua.avgUs;
        double speedup = twoStep.avgUs / Math.max(lua.avgUs, 0.001);
        System.out.println("-".repeat(80));
        System.out.printf("  Lua saves: %.3f µs per op  (%.1fx faster)%n", deltaUs, speedup);
        System.out.printf("  Two-step: %.1f ops/sec  Lua: %.1f ops/sec%n", twoStep.opsPerSec, lua.opsPerSec);
        System.out.println("  Note: Lua is 1 RTT vs 2 RTT. On local Docker, RTT ~0.2-0.5 ms.");
        System.out.println("  Expected: Lua ~5-15%% faster under low contention, similar under high (Redis single-threaded).");
        System.out.println("  Primary win is atomicity, not throughput.");
        System.out.println("=".repeat(80));

        // No hard fail on throughput — atomicity is the P0-3 goal. Just ensure Lua is not drastically slower (>50%).
        assertTrue(lua.avgUs < twoStep.avgUs * 1.5,
                String.format("Lua %.3f µs should not be >1.5× slower than two-step %.3f µs", lua.avgUs, twoStep.avgUs));
    }

    @Test
    void benchmark_burst_concurrent_atomicity() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ BURST ATOMICITY: 50 threads × 20 INCR = 1000 expected, single key, Lua EVAL");
        System.out.println("=".repeat(80));

        String key = "burst:atomic:" + System.nanoTime();
        int totalOps = CONCURRENCY * BURST_PER_THREAD;

        ExecutorService pool = Executors.newFixedThreadPool(CONCURRENCY);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(totalOps);
        List<Future<Long>> futures = new ArrayList<>(totalOps);

        for (int i = 0; i < totalOps; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                Long v = incrLua(key);
                done.countDown();
                return v;
            }));
        }
        long t0 = System.nanoTime();
        start.countDown();
        assertTrue(done.await(30, TimeUnit.SECONDS), "Burst timed out");
        long elapsedNs = System.nanoTime() - t0;
        pool.shutdownNow();

        // Verify final count == 1000
        String val = redisTemplate.opsForValue().get(key);
        assertNotNull(val);
        long finalCount = Long.parseLong(val);
        System.out.printf("  Final count: %d / expected %d%n", finalCount, totalOps);
        assertEquals(totalOps, finalCount, "Lua INCR must be atomic under concurrent burst");

        // Verify TTL exists and is within 60s (not -1, not -2)
        Long ttl = redisTemplate.getExpire(key, TimeUnit.MILLISECONDS);
        assertNotNull(ttl);
        System.out.printf("  TTL after burst: %d ms (expected ~60000, >0)%n", ttl);
        assertTrue(ttl > 0 && ttl <= TTL_MILLIS, "TTL must be set (Lua pexpire on first INCR)");

        // Verify TTL is not reset on each increment (fixed window, not sliding)
        Thread.sleep(120);
        Long ttlBefore = redisTemplate.getExpire(key, TimeUnit.MILLISECONDS);
        incrLua(key); // 1001st increment should NOT reset TTL
        Long ttlAfter = redisTemplate.getExpire(key, TimeUnit.MILLISECONDS);
        System.out.printf("  TTL before extra INCR: %d ms  after: %d ms%n", ttlBefore, ttlAfter);
        assertTrue(ttlAfter <= ttlBefore + 50, "TTL should not reset on subsequent INCR (fixed window)");

        double elapsedMs = elapsedNs / 1_000_000.0;
        double throughput = totalOps / (elapsedNs / 1_000_000_000.0);
        System.out.printf("  Burst elapsed: %.2f ms  throughput: %.1f ops/sec  concurrency: %d%n",
                elapsedMs, throughput, CONCURRENCY);
        System.out.println("  ✓ Atomicity verified: no lost increments, TTL persists, no permanent block");
        System.out.println("=".repeat(80));
    }

    @Test
    void verify_ttl_not_leaked_on_first_increment() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ TTL CORRECTNESS: first INCR sets TTL, no leak without TTL");
        System.out.println("=".repeat(80));

        String key = "ttl:check:" + System.nanoTime();
        Long c1 = incrLua(key);
        assertEquals(1L, c1);
        Long ttl1 = redisTemplate.getExpire(key, TimeUnit.MILLISECONDS);
        System.out.printf("  After 1st INCR: count=%d ttl=%d ms%n", c1, ttl1);
        assertTrue(ttl1 != null && ttl1 > 0 && ttl1 <= TTL_MILLIS, "TTL must be set on first increment");

        Long c2 = incrLua(key);
        assertEquals(2L, c2);
        Long ttl2 = redisTemplate.getExpire(key, TimeUnit.MILLISECONDS);
        System.out.printf("  After 2nd INCR: count=%d ttl=%d ms (should not be -1)%n", c2, ttl2);
        assertTrue(ttl2 != null && ttl2 > 0, "TTL must still exist after second INCR");

        for (int i = 0; i < 98; i++) incrLua(key);
        Long ttlFinal = redisTemplate.getExpire(key, TimeUnit.MILLISECONDS);
        String val = redisTemplate.opsForValue().get(key);
        System.out.printf("  After 100 INCR: count=%s ttl=%d ms%n", val, ttlFinal);
        assertEquals("100", val);
        assertTrue(ttlFinal != null && ttlFinal > 0, "TTL must never be -1 (no leak)");

        System.out.println("  ✓ TTL correctness verified: first INCR sets 60s, never leaks");
        System.out.println("=".repeat(80));
    }

    @Test
    void verify_twoStep_leak_scenario_documented() {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ DOCUMENTED LEAK: two-step INCR then crash before EXPIRE → no TTL (-1)");
        System.out.println("=".repeat(80));

        String key = "leak:sim:" + System.nanoTime();
        Long c = redisTemplate.opsForValue().increment(key);
        System.out.printf("  Simulated crash: INCR returned %d, skipped EXPIRE%n", c);
        Long ttl = redisTemplate.getExpire(key, TimeUnit.SECONDS);
        System.out.printf("  TTL after leaked INCR: %d (Redis returns -1 = no expire)%n", ttl);
        assertEquals(-1L, ttl, "Leaked key has no TTL — permanent block until manual DEL or restart");

        String key2 = "leak:lua:" + System.nanoTime();
        Long c2 = incrLua(key2);
        Long ttl2 = redisTemplate.getExpire(key2, TimeUnit.SECONDS);
        System.out.printf("  Lua EVAL: count=%d TTL=%d seconds (atomic, no leak)%n", c2, ttl2);
        assertTrue(ttl2 > 0, "Lua atomic path always leaves TTL");

        redisTemplate.delete(key);
        redisTemplate.delete(key2);
        System.out.println("  ✓ Leak scenario demonstrated: two-step vulnerable, Lua safe");
        System.out.println("=".repeat(80));
    }
}
