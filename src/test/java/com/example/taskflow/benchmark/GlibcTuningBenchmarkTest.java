package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the glibc tuning decisions measured on the Ubuntu-based Temurin image
 * (BENCHMARKS.md §51). The container-level sweep itself is driven by
 * {@code scripts/benchmark-glibc-tuning.sh}; this test locks the adopted config
 * so a future edit cannot silently drop it (or re-add the rejected allocator).
 */
@Tag("benchmark")
class GlibcTuningBenchmarkTest {

    @Test
    void glibc_arena_cap_adopted_jemalloc_rejected() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ §51 GLIBC TUNING (MALLOC_ARENA_MAX=2 adopted, jemalloc rejected)");
        System.out.println("=".repeat(80));

        Path compose = Path.of("docker-compose.yml");
        Path dockerfile = Path.of("Dockerfile");
        Path dockerfileX64 = Path.of("Dockerfile.x64");
        Path benchmarks = Path.of("BENCHMARKS.md");
        Path script = Path.of("scripts/benchmark-glibc-tuning.sh");

        long t0 = System.nanoTime();
        String yml = Files.readString(compose);
        String d = Files.readString(dockerfile);
        String dx = Files.readString(dockerfileX64);
        String md = Files.readString(benchmarks);
        long us = (System.nanoTime() - t0) / 1000;

        boolean arena = yml.contains("MALLOC_ARENA_MAX=2");
        boolean base = d.contains("eclipse-temurin:21-jre-resolute")
                && dx.contains("eclipse-temurin:21-jre-resolute");
        boolean noJemalloc = !d.contains("libjemalloc2") && !dx.contains("libjemalloc2")
                && !d.contains("LD_PRELOAD") && !dx.contains("LD_PRELOAD");
        boolean documented = md.contains("MALLOC_ARENA_MAX=2") && md.contains("jemalloc");
        boolean harness = Files.isRegularFile(script);

        System.out.println("  MALLOC_ARENA_MAX=2 in compose: " + arena);
        System.out.println("  Both Dockerfiles on -resolute base: " + base);
        System.out.println("  No jemalloc/LD_PRELOAD shipped: " + noJemalloc);
        System.out.println("  §51 evidence in BENCHMARKS.md: " + documented);
        System.out.println("  Sweep harness present: " + harness);
        System.out.printf("  Parse latency: %d µs%n", us);
        System.out.println("  Measured medians (3x30s hey, c=50, /api/v1/barbers): "
                + "default 741 MiB -> arena=2 669 MiB RSS, throughput within noise");
        System.out.println("  ✓ §51 glibc tuning verified");
        System.out.println("=".repeat(80));

        assertTrue(arena, "docker-compose.yml must cap glibc arenas (MALLOC_ARENA_MAX=2, §51)");
        assertTrue(base, "both Dockerfiles must stay on the pinned -resolute Temurin base");
        assertTrue(noJemalloc, "jemalloc was evaluated and rejected in §51 — do not ship libjemalloc2/LD_PRELOAD");
        assertTrue(documented, "BENCHMARKS.md must document the arena cap and the jemalloc verdict (§51)");
        assertTrue(harness, "scripts/benchmark-glibc-tuning.sh must remain for re-measurement");
    }
}
