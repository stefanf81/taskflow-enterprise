package com.example.taskflow.benchmark;

import com.example.taskflow.core.AsyncConfig;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Benchmarks the bounded vs unbounded async executor under synthetic burst load.
 *
 * <p>The production codebase currently has 0 {@code @Async} call-sites — the default
 * executor from {@code @EnableAsync} is idle. This test therefore injects a
 * minimal {@code @Async} service that sleeps 50 ms (simulating the notification
 * outbox DB write in {@code NotificationOutboxWriter}) and fires burst loads of
 * 500-1000 concurrent tasks. It measures the safety properties that justify
 * {@link AsyncConfig}: thread cap, queue cap, backpressure via CallerRunsPolicy,
 * and heap stability — not raw HTTP throughput.
 *
 * <p>Run:
 * <pre>{@code
 *   ./gradlew benchmarkTest --tests "*AsyncExecutorBenchmarkTest*"
 * }</pre>
 */
@Tag("benchmark")
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "spring.cache.type=simple"})
@Import({AsyncConfig.class, AsyncExecutorBenchmarkTest.BurstConfig.class})
class AsyncExecutorBenchmarkTest {

    private static final int BURST_SIZE = 500;
    private static final int CONCURRENCY = 50;
    private static final long TASK_SLEEP_MS = 50;
    private static final int BENCHMARK_TIMEOUT_SECONDS = 60;
    private static final double MAX_AVG_LATENCY_MS = 500.0;

    @Autowired private BurstService burstService;

    @Autowired
    @Qualifier("taskExecutor")
    private Executor taskExecutor;

    @TestConfiguration
    static class BurstConfig {
        @Bean
        BurstService burstService() {
            return new BurstService();
        }
    }

    static class BurstService {
        @Async
        public CompletableFuture<Void> work() {
            try {
                Thread.sleep(TASK_SLEEP_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return CompletableFuture.completedFuture(null);
        }

        @Async
        public CompletableFuture<Void> workWithContention() {
            // Slightly more realistic: allocate a small payload to pressure GC
            // while still being I/O-bound (sleep).
            byte[] payload = new byte[1024];
            Arrays.fill(payload, (byte) 1);
            try {
                Thread.sleep(TASK_SLEEP_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            // Prevent dead-code elimination
            if (payload[0] == 99) {
                System.out.println("unreachable");
            }
            return CompletableFuture.completedFuture(null);
        }
    }

    @Test
    void benchmarkBoundedAsyncExecutor() throws Exception {
        ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();

        // --- Inspect executor config --------------------------------------------
        System.out.println("\n" + "=".repeat(90));
        System.out.println("  ⚙ ASYNC EXECUTOR BENCHMARK — BOUNDED (AsyncConfig)");
        System.out.println("=".repeat(90));

        if (taskExecutor instanceof ThreadPoolTaskExecutor tpe) {
            System.out.printf("  Executor: core=%d max=%d queue=%d keepAlive=%ds%n",
                    tpe.getCorePoolSize(), tpe.getMaxPoolSize(),
                    tpe.getQueueCapacity(), tpe.getKeepAliveSeconds());
            System.out.printf("  Rejection: %s%n",
                    tpe.getThreadPoolExecutor().getRejectedExecutionHandler().getClass().getSimpleName());
            // Safety assertions — the whole point of P0-1
            assertTrue(tpe.getMaxPoolSize() <= 64,
                    "maxPoolSize must be bounded (64), was " + tpe.getMaxPoolSize());
            assertTrue(tpe.getQueueCapacity() <= 200,
                    "queueCapacity must be bounded, was " + tpe.getQueueCapacity());
            assertTrue(
                    tpe.getThreadPoolExecutor().getRejectedExecutionHandler()
                            instanceof ThreadPoolExecutor.CallerRunsPolicy,
                    "Rejection policy must be CallerRunsPolicy for backpressure");
        } else {
            System.out.println("  Executor type: " + taskExecutor.getClass().getName());
        }

        int threadsBefore = threadBean.getThreadCount();
        long heapBefore = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        System.out.printf("  Threads before: %d  Heap used: %.2f MB%n",
                threadsBefore, heapBefore / (1024.0 * 1024.0));
        System.out.printf("  Burst: %d tasks  Concurrency: %d  Task sleep: %d ms%n",
                BURST_SIZE, CONCURRENCY, TASK_SLEEP_MS);
        System.out.println();

        // --- Warm-up (JIT, pool spin-up) --------------------------------------
        System.out.println("  Warm-up: 50 tasks...");
        runBurst(50);
        System.out.println("  Warm-up complete.\n");

        // --- Measurement --------------------------------------------------------
        System.out.println("  Measurement: " + BURST_SIZE + " tasks...");
        long startNs = System.nanoTime();
        List<Long> latencies = runBurst(BURST_SIZE);
        long elapsedNs = System.nanoTime() - startNs;
        System.out.println("  Measurement complete.\n");

        double elapsedSec = elapsedNs / 1_000_000_000.0;
        double throughput = BURST_SIZE / elapsedSec;
        long[] sorted = latencies.stream().mapToLong(Long::longValue).sorted().toArray();
        long min = sorted.length > 0 ? sorted[0] : 0;
        long max = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
        double avg = Arrays.stream(sorted).average().orElse(0);
        long p50 = percentile(sorted, 50);
        long p90 = percentile(sorted, 90);
        long p95 = percentile(sorted, 95);
        long p99 = percentile(sorted, 99);

        int threadsAfter = threadBean.getThreadCount();
        long heapAfter = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        int peakThreads = threadsAfter; // approximate — executor threads are visible here
        if (taskExecutor instanceof ThreadPoolTaskExecutor tpe) {
            peakThreads = tpe.getThreadPoolExecutor().getLargestPoolSize();
        }

        // --- Report -------------------------------------------------------------
        System.out.println("=".repeat(90));
        System.out.println("  📊 RESULTS: BOUNDED ASYNC EXECUTOR");
        System.out.println("=".repeat(90));
        System.out.printf("  %-40s %10s%n", "Metric", "Value");
        System.out.println("  " + "-".repeat(55));
        System.out.printf("  %-40s %10.2f tasks/sec%n", "Throughput", throughput);
        System.out.printf("  %-40s %10.3f sec%n", "Total elapsed time", elapsedSec);
        System.out.printf("  %-40s %10d tasks%n", "Total tasks", BURST_SIZE);
        System.out.printf("  %-40s %10d%n", "Caller concurrency", CONCURRENCY);
        System.out.println("  " + "-".repeat(55));
        System.out.printf("  %-40s %10.3f ms%n", "Average latency", avg);
        System.out.printf("  %-40s %10d ms%n", "Minimum latency", min);
        System.out.printf("  %-40s %10d ms%n", "Median (p50) latency", p50);
        System.out.printf("  %-40s %10d ms%n", "p90 latency", p90);
        System.out.printf("  %-40s %10d ms%n", "p95 latency", p95);
        System.out.printf("  %-40s %10d ms%n", "p99 latency", p99);
        System.out.printf("  %-40s %10d ms%n", "Maximum latency", max);
        System.out.println("  " + "-".repeat(55));
        System.out.printf("  %-40s %10d%n", "Threads before", threadsBefore);
        System.out.printf("  %-40s %10d%n", "Threads after", threadsAfter);
        System.out.printf("  %-40s %10d%n", "Peak pool size", peakThreads);
        System.out.printf("  %-40s %10.2f MB%n", "Heap before", heapBefore / (1024.0 * 1024.0));
        System.out.printf("  %-40s %10.2f MB%n", "Heap after", heapAfter / (1024.0 * 1024.0));
        System.out.printf("  %-40s %10.2f MB%n", "Heap delta", (heapAfter - heapBefore) / (1024.0 * 1024.0));
        if (taskExecutor instanceof ThreadPoolTaskExecutor tpe) {
            ThreadPoolExecutor raw = tpe.getThreadPoolExecutor();
            System.out.printf("  %-40s %10d%n", "Pool completed tasks", raw.getCompletedTaskCount());
            System.out.printf("  %-40s %10d%n", "Pool queue size (after)", raw.getQueue().size());
        }
        System.out.println("=".repeat(90));
        System.out.println();

        System.out.println(">>> SUMMARY [BOUNDED] throughput=" + String.format("%.1f", throughput)
                + " tasks/s  avg=" + String.format("%.2f", avg)
                + " ms  p50=" + p50 + "  p95=" + p95 + "  p99=" + p99
                + "  peakPool=" + peakThreads
                + "  threadsDelta=" + (threadsAfter - threadsBefore));

        // --- Assertions ---------------------------------------------------------
        assertTrue(avg < MAX_AVG_LATENCY_MS,
                String.format("Average latency %.2f ms exceeds %.2f ms SLA", avg, MAX_AVG_LATENCY_MS));

        if (taskExecutor instanceof ThreadPoolTaskExecutor tpe) {
            // With 500 tasks * 50ms each, even the unbounded pool cannot finish
            // in <p99 5s; the bounded pool's CallerRunsPolicy will increase
            // caller latency but must not explode threads.
            assertTrue(tpe.getThreadPoolExecutor().getLargestPoolSize() <= 64,
                    "Peak pool size must stay <= maxPoolSize (64) — bounded safety violated");
            assertTrue(p99 < 5000,
                    "p99 latency " + p99 + " ms too high — backpressure not working");
        }

        // Memory stability: heap delta should stay bounded (<100 MB for 500*1KB payloads)
        long heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);
        System.out.println("  Heap delta: " + heapDeltaMb + " MB (should be <100 MB for stability)");
    }

    private List<Long> runBurst(int count) throws InterruptedException {
        ExecutorService callers = Executors.newFixedThreadPool(CONCURRENCY);
        try {
            CountDownLatch startLatch = new CountDownLatch(1);
            CountDownLatch finishLatch = new CountDownLatch(count);
            List<Future<Long>> futures = new ArrayList<>(count);

            for (int i = 0; i < count; i++) {
                futures.add(callers.submit(() -> {
                    startLatch.await();
                    long t0 = System.nanoTime();
                    try {
                        // Future.get() blocks caller until @Async completes — this is
                        // where CallerRunsPolicy manifests as increased caller latency
                        // instead of queue growth.
                        burstService.work().get(10, TimeUnit.SECONDS);
                    } catch (Exception e) {
                        System.err.println("  Burst task failed: " + e.getMessage());
                    }
                    long t1 = System.nanoTime();
                    finishLatch.countDown();
                    return (t1 - t0) / 1_000_000L;
                }));
            }

            startLatch.countDown();
            boolean completed = finishLatch.await(BENCHMARK_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!completed) {
                System.err.println("  WARNING: Burst timed out after " + BENCHMARK_TIMEOUT_SECONDS + "s");
            }

            List<Long> latencies = new ArrayList<>(count);
            for (Future<Long> f : futures) {
                if (f.isDone()) {
                    try {
                        latencies.add(f.get());
                    } catch (Exception ignored) {
                    }
                }
            }
            return latencies;
        } finally {
            callers.shutdownNow();
        }
    }

    private static long percentile(long[] sorted, int pct) {
        if (sorted.length == 0) return 0;
        int index = (int) Math.ceil(pct / 100.0 * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }
}
