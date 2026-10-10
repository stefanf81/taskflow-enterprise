# ADR-016: glibc Allocator Tuning on Ubuntu Base (MALLOC_ARENA_MAX)

**Status:** Accepted

## Context

The backend container image was migrated from `eclipse-temurin:21-jre-alpine` (musl libc) to `eclipse-temurin:21-jre-resolute` (glibc on Ubuntu 26.04 LTS). Throughput and latency between musl and glibc were at parity (+0.9% RPS, inside run noise; cold start 2.43 s vs 2.61 s), but Ubuntu introduced a +59 MiB RSS memory penalty and an increase in base image size (188 MB → 228 MB).

Under glibc, memory allocation arenas scale dynamically to `8 × CPU_CORES`. In a containerized multithreaded JVM with Virtual Thread carrier pools, worker threads, and HikariCP connection threads, native allocations spread across separate per-thread arenas, causing native memory fragmentation and excessive RSS growth.

## Decision

1. **Standardize on `eclipse-temurin:21-jre-resolute`:** Retain the digest-pinned Ubuntu base for upstream LTS support and reduced CVE friction (0 fixable HIGH/CRITICAL findings vs 6 on the pinned Alpine image).
2. **Constrain glibc memory arenas via `MALLOC_ARENA_MAX=2`:**
   - Deployed in `docker-compose.yml` backend environment and mirrored in Kubernetes production deployment manifests (`homelab/TF/gitops/apps/taskflow/backend.yaml`).
   - Capping arenas to 2 throttles native memory fragmentation without thread contention on the 4–8 core deployment targets.
3. **Reject jemalloc (`LD_PRELOAD=libjemalloc.so.2`):** Measured +165 MiB RSS with no throughput gain; `libjemalloc2` is deliberately excluded from runtime Dockerfiles.
4. **Omit JVM flag `-XX:+UseTransparentHugePages`:** The underlying Linux host/VM already runs `THP=always` (collapsing 400–560 MiB into `AnonHugePages`), so the HotSpot flag provides no measurable performance improvement.

## Consequences

### Positive
- **RSS Reduction:** Reclaims **~72 MiB (−9.7%) RSS** (741 MiB → 669 MiB) with no degradation in throughput (14,429 RPS vs 14,523 RPS) or G1 pause duration (1.54 ms avg / 4.99 ms p99).
- **Predictable Memory Footprint:** Prevents native heap ballooning from breaching the 2.5 GiB container memory limit on high-core machines.

### Negative
- **glibc-Specific Knob:** `MALLOC_ARENA_MAX` is specific to GNU libc; it has no effect in musl/Alpine environments.
- **Slight Lock Contention Risk at High Scale:** If thread counts scale drastically (>100 platform threads), capping to 2 arenas could theoretically introduce lock contention on the glibc heap lock. At current carrier and pool sizing (Hikari 25, async pool 8–64), contention was measured at 0%.

## Verification

- Automated test: `src/test/java/com/example/taskflow/benchmark/GlibcTuningBenchmarkTest.java` asserts `MALLOC_ARENA_MAX=2` in compose, the pinned base digest, and absence of `libjemalloc2`.
- Benchmark harness: `scripts/benchmark-glibc-tuning.sh` records RPS, p95/p99, RSS, and GC pause stats (BENCHMARKS.md §51).
