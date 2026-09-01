# ADR-010: Bounded Async Executor

**Status:** Accepted

## Context

Spring Boot auto-configures a `ThreadPoolTaskExecutor` for `@EnableAsync` with `corePoolSize=8`, `maxPoolSize=Integer.MAX_VALUE`, and `queueCapacity=Integer.MAX_VALUE`. Logback's `AsyncAppender` adds a second queue (`queueSize 16384` in `logback-spring.xml`). On a 1.25 GiB container (local: 2560M limit × `MaxRAMPercentage=50.0`; prod: 2Gi × 50% = 1 GiB heap) with a Hikari pool of 25 connections, an unbounded executor can grow threads and queue entries without bound under burst load (notification/outbox, future webhooks or mail). This risks heap exhaustion (OOM) and connection-pool starvation with no backpressure signal. The default `AbortPolicy` would also silently drop tasks when the pool saturates.

The application enables virtual threads (`spring.threads.virtual.enabled=true`) but the async executor remains a platform-thread pool — its bounds must be explicit so burst work does not escape container quotas.

## Decision

Introduce `src/main/java/com/example/taskflow/core/AsyncConfig.java` implementing `AsyncConfigurer`:

```java
corePoolSize=8          // matches Spring default
maxPoolSize=64          // caps threads to fit 1.25 GiB heap + 25-conn Hikari pool
queueCapacity=100       // bounds queued work; excess triggers backpressure
keepAliveSeconds=60
threadNamePrefix=taskflow-async-
rejectedExecutionHandler=CallerRunsPolicy
waitForTasksToCompleteOnShutdown=true
awaitTerminationSeconds=30
```

* `CallerRunsPolicy` is the backpressure mechanism: when the queue is full the submitting thread runs the task inline. Latency rises on the caller but the system stays live instead of growing heap or dropping tasks. Callers that need explicit rejection handling should use `@Async` return types (`CompletableFuture`) and handle the caller-run path.
* `waitForTasksToCompleteOnShutdown` with a 30 s grace aligns with `server.shutdown=graceful` / `spring.lifecycle.timeout-per-shutdown-phase=30s` and the Compose `stop_grace_period: 40s` (and the corresponding `terminationGracePeriodSeconds` in the GitOps `backend.yaml`).
* The bean is named `taskExecutor` so it replaces the auto-configured executor.

`AsyncUncaughtExceptionHandler` logs unhandled async exceptions with `LogSanitizer.safeMessage` at `ERROR` level.

`logback-spring.xml` retains the bounded logging queue, preserves every level (`discardingThreshold=0`), blocks the producer when full (`neverBlock=false`), and flushes for up to 30 s on Spring Boot's logging shutdown hook. This makes overload visible as caller latency rather than silently dropping operational logs.

## Consequences

### Positive
- **Bounded memory footprint:** Threads and queue cannot grow to `Integer.MAX_VALUE`; heap delta stays <5 MB under burst (BENCHMARKS.md §38).
- **Graceful backpressure, not OOM:** Burst load (500 tasks / 50 callers, 50 ms simulated work) measures **148 tasks/sec**, **319 ms avg**, **peak 8 threads**, **p99 <5 s**, queue drained to 0. The 64-thread cap is a safety rail — production peaks at 8.
- **No steady-state overhead:** The pool is idle when no `@Async` call-sites are active; the bound is purely a safety envelope for future async work (outbox, webhooks) without later retuning.
- **Graceful shutdown:** In-flight async work drains within the 30 s window on `SIGTERM`.

### Negative
- **Caller latency under burst:** `CallerRunsPolicy` throttles the caller thread when the queue fills — p95/p99 rise to ~480 ms / <5 s instead of queueing unbounded. This is intentional backpressure and must be accounted for in upstream timeout budgets.
- **Tuning point:** If future async work becomes throughput-critical, `maxPoolSize` / `queueCapacity` may need a sweep against Hikari pool and heap headroom (see `P1AndP2BenchmarkTest` and `AsyncExecutorBenchmarkTest`).

## Verification

Benchmark: `src/test/java/com/example/taskflow/benchmark/AsyncExecutorBenchmarkTest.java` (`@Tag("benchmark")`, synthetic burst with 500 tasks, warm-up 50). Verification checks in `P1AndP2BenchmarkTest` confirm `AsyncConfig` contains `maxPoolSize=64`, `queueCapacity=100`, and `CallerRunsPolicy`.
