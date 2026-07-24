package com.example.taskflow.benchmark;

import com.example.taskflow.auth.TestSecurityConfig;
import org.junit.jupiter.api.Tag;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * BASELINE — Platform Threads ({@code spring.threads.virtual.enabled=false}).
 * <p>
 * Runs the identical I/O-bound mixed workload as {@link VirtualThreadBenchmarkTest}
 * but with the current (default) platform-thread-based Tomcat executor.
 * <p>
 * Compare throughput and p50/p95/p99 latency between the two modes to determine
 * whether Virtual Threads benefit TaskFlow's I/O-bound REST endpoints.
 * <p>
 * <b>Run mode:</b>
 * <pre>{@code
 *   ./gradlew benchmarkTest --tests *PlatformThreadBenchmarkTest
 * }</pre>
 *
 * @see VirtualThreadBenchmarkTest
 * @see BaseVirtualThreadBenchmark
 */
@Tag("benchmark")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.threads.virtual.enabled=false",
        "app.rate-limit.enabled=false",
        "app.stats.cache.ttl=0",
        "spring.datasource.hikari.maximum-pool-size=10",
        "spring.datasource.hikari.minimum-idle=10"
    }
)
@Import(TestSecurityConfig.class)
class PlatformThreadBenchmarkTest extends BaseVirtualThreadBenchmark {

    // All benchmark logic is inherited from BaseVirtualThreadBenchmark.
    // This class only configures the Spring Boot test context to use
    // platform threads (the current production setting).
}
