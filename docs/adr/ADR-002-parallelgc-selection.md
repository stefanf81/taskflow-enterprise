# ADR-002: ParallelGC vs G1GC

**Status:** Superseded (Superseded by G1GC configuration in production and local runtime)

## Context

The Java Virtual Machine defaults to G1GC (Garbage-First Garbage Collector) since JDK 9. G1GC is a region-based, low-pause collector designed for predictable pause times.

TaskFlow was initially evaluated under ParallelGC. However, as Virtual Threads were enabled in Spring Boot 4.1 / OpenJDK 21, predictable pause times became paramount to prevent carrier thread starvation under high concurrency.

## Decision (Superseded)

**G1GC with `-XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:+AlwaysPreTouch`** was adopted across `docker-compose.yml` and GitOps Kubernetes deployment manifests (`JAVA_TOOL_OPTIONS`).

Key factors for selecting G1GC:
1. **Low Pause Time SLA** — `-XX:MaxGCPauseMillis=100` guarantees sub-100ms GC pauses, preventing Virtual Thread carrier thread stalls.
2. **Concurrent Marking** — G1GC handles heap marking concurrently alongside Virtual Thread execution.
3. **Container Heap Sizing** — Memory limits managed via `MaxRAMPercentage=50.0` (1 GiB heap on 2 GiB container) with `AlwaysPreTouch` for eager page allocation.

## Consequences

### Positive
- **Predictable carrier thread latency** — sub-100ms pause target prevents tail latency spikes.
- **Concurrent GC cycles** — background collection minimizes stop-the-world pauses.

### Negative
- Higher GC metadata memory footprint (~10-15% of total RAM), accounted for by reserving 50% RAM for off-heap / Metaspace / DirectMemory.
