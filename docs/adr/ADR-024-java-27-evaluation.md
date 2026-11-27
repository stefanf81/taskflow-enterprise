# ADR-024: Java 27 Evaluated, Not Adopted

**Status:** Not adopted (2026-11-27). Production stays on Java 25 LTS (ADR-020). The upgrade is implemented and tested on two branches, kept as ready-made upgrades:
- `claude/java27-runtime-only` (Option A): Java 25 bytecode on a Java 27 runtime.
- `claude/java27-full` (Option B): Java 27 toolchain and runtime.

## Context

JDK 26 (March 2026) and JDK 27 (September 2026) have shipped since ADR-020. Java 27 is not an LTS: its updates end when JDK 28 ships (2027-03-09). The next LTS is 29 (September 2027).

The project's rule for new JDK features: adopt one only where it measures better than the current Java 25 setup.

Both branches pass on Temurin 27.0.1.1:
- `./gradlew check`: 875 tests, 0 failures;
- `testcontainersTest`: 50/50;
- container guards: 27/27;
- the AOT cache trains and passes the strict `-XX:AOTMode=on` boot validation.

Gradle 9.9.2, Spring Boot 4.2.0, JaCoCo 0.8.16, SpotBugs 4.10.5, ArchUnit 1.5.1 and Byte Buddy already support Java 27.

## Measurements

Full method, tables and profiles: BENCHMARKS.md §86 and §87.

- **Throughput:** Java 27 is 7–18% slower than Java 25 on this service on native amd64, on two Intel Xeon generations; Options A and B behave the same. Startup is 5–6% faster.
- **Root cause:** a change in JDK 26's virtual-thread scheduling.
  - `VirtualThread` now submits continuations as `ForkJoinTask.adapt(..)` tasks. These lack the `NO_USER_HELP` bit that JDK 25's `RunnableExecuteAction` carried.
  - `ForkJoinPool.runWorker` uses that bit for wake-up propagation, so the carrier threads park and unpark constantly: 0 voluntary context switches in 10 s on 25, more than 31,000 on 27, in a standalone reproducer.
  - It is the `VirtualThread` half of JDK-8360046 that the jdk26 backout JDK-8375130 kept.
  - A diagnostic java.base patch that restores the bit makes 27 7–11% faster than unpatched 27 and faster than 25.
- **Java 26/27 features measured** (§86, §87):

| Feature | Measured effect here | Verdict |
| :--- | :--- | :--- |
| Compact object headers (on by default in 27; opt-in on 25, JEP 519) | 7–9% less allocation per request; throughput unchanged on its own | Usable on Java 25; candidate |
| G1 keeps its heap (27 defaults `MinHeapFreeRatio=0`, `MaxHeapFreeRatio=100`, `GCTimeRatio=24`; flags on 25) | 70–80% fewer GC pauses, +1 to +7% throughput and 4–9% lower p99 on Java 25; about +550 MiB RSS | Usable on Java 25; candidate |
| Faster startup with the AOT cache | 5–6% | Only with 27; does not outweigh the regression |
| ZGC with the AOT cache (JEP 516) | 7–12% slower, about +440 MiB RSS | Rejected |
| Always-on JFR with default redaction (JEP 536) | From boot: startup nearly doubles. Started after boot: 6–8% slower | Rejected for always-on |
| Single virtual-thread carrier (`jdk.virtualThreadScheduler.parallelism=1`) | 22–40% slower on both JDKs | Rejected |
| Post-quantum hybrid TLS key exchange (JEP 527) | Not measurable here (no outbound TLS in the benchmark) | Arrives with any upgrade |
| Previews: structured concurrency, lazy constants, PEM API, primitive patterns | Not evaluated | Not used (preview, would tie class files to one JDK) |

## Decision

1. **Do not upgrade to Java 27.** Keep Java 25 LTS (ADR-020). The 26/27 improvements are real but are cancelled by the virtual-thread scheduling regression, and this service runs on virtual threads (ADR-001).
2. **Keep both branches** as ready-made upgrades. Re-evaluate when a JDK restores `NO_USER_HELP`, or equivalent signalling, for virtual-thread continuations; check this before any move to 28 or 29.
3. **Report the regression upstream.** A plain-text report for the OpenJDK loom-dev list, with an inlined standalone reproducer, has been prepared; it has not been sent.
4. **Follow-up candidate on Java 25, not applied here** (§87):
   - Java 27's G1 heap-sizing defaults in the deployment's `JAVA_TOOL_OPTIONS`, after checking RSS against the production memory limit.
   - Optionally compact object headers, in the Dockerfile's training run and `CMD` together (ADR-020 decision 4).
   - Confirm both on the production host first.

## Consequences

- No runtime change on `main`; rollback concerns of ADR-020 are unchanged.
- **Other findings** (§86):
  - JDK 26.0.2.1 cannot load its own AOT cache for this application and exits even in `AOTMode=auto`.
  - With G1, platform-thread hand-offs are slower on 26/27 in the reproducer; this is a separate G1 effect.
  - Under strict integrity modes, 14 tests fail, all on final-field mutation in test code (spring-security-test, `SecurityConfigTest.rsaKey`).
  - Production code passes.
