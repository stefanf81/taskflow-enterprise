package com.example.taskflow.benchmark;

import com.example.taskflow.auth.TestSecurityConfig;
import org.junit.jupiter.api.Tag;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * EXPERIMENT — Virtual Threads ({@code spring.threads.virtual.enabled=true}).
 * <p>
 * Runs the identical I/O-bound mixed workload as {@link PlatformThreadBenchmarkTest}
 * but with Virtual Threads enabled for the Tomcat request-processing executor.
 * <p>
 * In this mode, each HTTP request is dispatched on a virtual (lightweight)
 * thread rather than a platform (OS) thread. When a request blocks on I/O
 * (JDBC query, cache lookup, etc.), the virtual thread is unmounted from the
 * carrier thread, allowing another request to proceed — potentially increasing
 * throughput under I/O-bound workloads.
 * <p>
 * <b>Run mode:</b>
 * <pre>{@code
 *   ./gradlew benchmarkTest --tests *VirtualThreadBenchmarkTest
 * }</pre>
 *
 * @see PlatformThreadBenchmarkTest
 * @see BaseVirtualThreadBenchmark
 */
@Tag("benchmark")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.threads.virtual.enabled=true",
        "app.rate-limit.enabled=false",
        "app.stats.cache.ttl=0",
        "spring.datasource.hikari.maximum-pool-size=10",
        "spring.datasource.hikari.minimum-idle=10"
    }
)
@Import(TestSecurityConfig.class)
class VirtualThreadBenchmarkTest extends BaseVirtualThreadBenchmark {

    // All benchmark logic is inherited from BaseVirtualThreadBenchmark.
    // This class only configures the Spring Boot test context to use
    // virtual threads for Tomcat request processing.
}
