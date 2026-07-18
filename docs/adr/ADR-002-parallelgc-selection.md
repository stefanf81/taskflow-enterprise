# ADR-002: ParallelGC vs G1GC

**Status:** Accepted

## Context

The Java Virtual Machine defaults to G1GC (Garbage-First Garbage Collector) since JDK 9. G1GC is a region-based, low-pause collector designed for large heaps and predictable pause times. ParallelGC is a throughput-oriented collector that freezes application threads during collection but completes the work faster overall.

TaskFlow is an I/O-bound web application. The majority of request processing time is spent waiting on database queries, Redis cache lookups, and network I/O — not on CPU-bound computation or object allocation. The local development environment runs on Apple Silicon M4 Pro with a fixed 1 GB heap (`-Xms1g -Xmx1g`). Production runs in a container with heap scaled via `MaxRAMPercentage=60.0`.

## Decision

**ParallelGC** was chosen over G1GC for the following reasons:

1. **I/O-bound workload** — the application spends most of its time waiting for I/O (database, Redis, network), not allocating objects. GC pressure is minimal regardless of the collector, so the advanced heuristics of G1GC provide little benefit.

2. **Lower CPU overhead for small heaps** — ParallelGC uses a simpler collection algorithm with fewer concurrent threads and less bookkeeping than G1GC. On a 1 GB heap, G1GC's region-based tracking and concurrent marking consume CPU cycles that ParallelGC avoids entirely.

3. **Simpler tuning** — ParallelGC has fewer tuning knobs. With a fixed heap size (`-Xms1g -Xmx1g`), the only meaningful parameters are `-XX:ParallelGCThreads` and `-XX:+UseAdaptiveSizePolicy`. G1GC requires tuning `-XX:G1HeapRegionSize`, `-XX:MaxGCPauseMillis`, `-XX:G1NewSizePercent`, and others to achieve optimal behavior.

4. **Marginal G1GC benefit at 1 GB** — G1GC shines with multi-GB heaps where its region-based collection can collect incrementally without full GCs. At 1 GB, the heap is small enough that a full ParallelGC collection completes in milliseconds.

5. **Production consistency** — Production uses the same collector (`ParallelGC`) with `MaxRAMPercentage=60.0`. The container orchestrator's CPU allocation determines parallelism, not hardcoded thread counts.

## Consequences

### Positive
- **Lower CPU overhead** — less CPU time spent on GC bookkeeping for the same workload.
- **Simpler GC log analysis** — ParallelGC logs are straightforward: young collections and full collections, with clear timings.
- **Consistent behavior** — the same collector across dev and prod environments.

### Negative
- **Longer full GC pauses** — ParallelGC performs full GCs as a single "stop-the-world" event, whereas G1GC can spread them across multiple incremental steps. In practice, full GCs are rare for this I/O-bound workload.
- **Not adaptable to very large heap growth** — if the heap were to grow to 8 GB+, G1GC would likely outperform ParallelGC. The application's data model is not expected to require such growth.
