package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the container configuration decisions measured in BENCHMARKS.md §42, §43 and §47:
 * the split nginx cache locations, the deployment-owned JVM diagnostics in docker-compose.yml,
 * and the HEALTHCHECK that only the local {@code Dockerfile} carries.
 *
 * <p>These assertions used to live in {@link P1AndP2BenchmarkTest}, which is tagged
 * {@code benchmark} and therefore excluded from the default {@code test} task; no workflow
 * runs {@code benchmarkTest}, so the guards never executed in CI. They only read checked-in
 * files, so they belong in the default suite.
 */
class ContainerConfigGuardTest {

    @Test
    void p1_1_nginx_immutable_config() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ P1-1 NGINX IMMUTABLE (hashed js/css) vs public");
        System.out.println("=".repeat(80));
        Path nginx = Path.of("frontend/nginx.conf");
        assertTrue(Files.exists(nginx), "frontend/nginx.conf must exist");
        String content = Files.readString(nginx);
        long t0 = System.nanoTime();
        boolean hasJsCssImmutable = content.contains("location ~* \\.(?:js|css)$") && content.contains("immutable, max-age=15552000");
        boolean hasIcoPublic = content.contains("location ~* \\.(?:ico|gif")
                && content.contains("public, max-age=3600, must-revalidate");
        boolean oldSingle = content.contains("location ~* \\.(?:ico|css|js|gif");
        long us = (System.nanoTime() - t0) / 1000;

        System.out.println("  js/css immutable block: " + hasJsCssImmutable);
        System.out.println("  ico/gif public block: " + hasIcoPublic);
        System.out.println("  old single block (should be false): " + oldSingle);
        System.out.printf("  Parse latency: %d µs%n", us);

        assertTrue(hasJsCssImmutable, "js/css must have immutable max-age=15552000");
        assertTrue(hasIcoPublic, "unhashed images/fonts must use a short revalidating public cache");
        assertFalse(oldSingle, "old single location with mixed types must be split");

        // Verify index.html not immutable (served via location / try_files)
        assertTrue(content.contains("location / {") && content.contains("try_files"), "index.html via location /");

        System.out.println("  Expected saving: 1 year immutable → 0 revalidation for 15552000s vs 6M public");
        System.out.println("  With outputHashing:all, browser skips If-None-Match for js/css → ~0 ms revalidate");
        System.out.println("  ✓ P1-1 nginx immutable verified");
        System.out.println("=".repeat(80));
    }

    @Test
    void p1_2_jvm_diagnostics_flags() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ P1-2 JVM DIAGNOSTICS (HeapDump + GC log + UseContainerSupport)");
        System.out.println("=".repeat(80));
        Path compose = Path.of("docker-compose.yml");
        String yml = Files.readString(compose);
        long t0 = System.nanoTime();
        boolean hasHeapDump = yml.contains("HeapDumpOnOutOfMemoryError") && yml.contains("HeapDumpPath=/tmp/heapdump.hprof");
        boolean hasGcLog = yml.contains("Xlog:gc") && yml.contains("/tmp/gc.log");
        boolean hasContainer = yml.contains("UseContainerSupport");
        boolean hasUseG1GC = yml.contains("UseG1GC");
        long us = (System.nanoTime() - t0) / 1000;

        System.out.println("  HeapDump flag: " + hasHeapDump);
        System.out.println("  GC log flag: " + hasGcLog);
        System.out.println("  UseContainerSupport: " + hasContainer);
        System.out.println("  UseG1GC preserved: " + hasUseG1GC);
        System.out.printf("  Parse latency: %d µs%n", us);

        assertTrue(hasHeapDump, "docker-compose must have HeapDumpOnOutOfMemoryError");
        assertTrue(hasGcLog, "must have Xlog:gc*:file=/tmp/gc.log");
        assertTrue(hasContainer, "UseContainerSupport explicit");
        assertTrue(hasUseG1GC, "G1GC must remain");

        Path dockerfile = Path.of("Dockerfile");
        Path dockerfileX64 = Path.of("Dockerfile.x64");
        String d = Files.readString(dockerfile);
        String dx = Files.readString(dockerfileX64);
        assertTrue(d.contains("HEALTHCHECK"), "Dockerfile HEALTHCHECK required (P1-6 local)");
        // x64 is k8s — variables & probes are set in homelab/TF YAML, not Dockerfile
        assertFalse(dx.contains("HEALTHCHECK"), "Dockerfile.x64 must not have HEALTHCHECK — k8s uses livenessProbe via yaml");

        System.out.println("  Overhead: GC log ~0.7% at 10% sampling per §7, heap dump 0% until OOM, tmpfs /tmp already");
        System.out.println("  Dockerfile local has HEALTHCHECK, Dockerfile.x64 correctly omits (k8s)");
        System.out.println("  ✓ P1-2 JVM diagnostics verified");
        System.out.println("=".repeat(80));
    }
}
