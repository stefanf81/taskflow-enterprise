package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the container configuration decisions measured in BENCHMARKS.md §42, §43, §47 and
 * §56: the split nginx cache locations, the deployment-owned JVM diagnostics in
 * docker-compose.yml, the HEALTHCHECK that only the Dockerfile's {@code local} target carries,
 * and the single-Dockerfile layout whose target platform is chosen by the builder.
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

        String d = Files.readString(Path.of("Dockerfile"));
        boolean localHealthcheck = !DockerfileStages.instructions(d, "local", "HEALTHCHECK").isEmpty();
        // prod is k8s — variables & probes are set in homelab/TF YAML, not the Dockerfile. A
        // HEALTHCHECK is inherited, so the stages prod derives from must not carry one either.
        boolean prodHealthcheck = !DockerfileStages.instructions(d, "prod", "HEALTHCHECK").isEmpty()
                || !DockerfileStages.instructions(d, "runtime", "HEALTHCHECK").isEmpty()
                || !DockerfileStages.instructions(d, "java-base", "HEALTHCHECK").isEmpty();
        assertTrue(localHealthcheck, "the local target needs a HEALTHCHECK (P1-6 local)");
        assertFalse(prodHealthcheck, "the prod target must not have a HEALTHCHECK — k8s uses livenessProbe via yaml");

        System.out.println("  Overhead: GC log ~0.7% at 10% sampling per §7, heap dump 0% until OOM, tmpfs /tmp already");
        System.out.println("  local target has HEALTHCHECK, prod target correctly omits (k8s)");
        System.out.println("  ✓ P1-2 JVM diagnostics verified");
        System.out.println("=".repeat(80));
    }

    @Test
    void single_dockerfile_two_targets_builder_owned_platform() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ §56 ONE DOCKERFILE (prod + local targets, platform from the builder)");
        System.out.println("=".repeat(80));
        String d = Files.readString(Path.of("Dockerfile"));
        String compose = Files.readString(Path.of("docker-compose.yml"));
        String ci = Files.readString(Path.of(".github/workflows/ci.yml"));
        String push = Files.readString(Path.of(".github/workflows/pushdockerimage.yml"));

        boolean noSecondFile = !Files.exists(Path.of("Dockerfile.x64"));
        boolean twoTargets = d.contains("FROM runtime AS prod") && d.contains("FROM runtime AS local");
        boolean sharedTraining = DockerfileStages.instructions(d, "cds-training", "RUN")
                .contains("-XX:ArchiveClassesAtExit=/tmp/application.jsa");
        List<String> platformFroms = d.lines().filter(line -> line.startsWith("FROM --platform=")).toList();
        boolean onlyBuildPlatform = !d.contains("ARG PLATFORM")
                && platformFroms.equals(List.of("FROM --platform=$BUILDPLATFORM ${JAVA_IMAGE} AS extractor"));
        boolean composeLocal = compose.contains("target: local");
        boolean workflowsProd = ci.contains("target: prod") && ci.contains("platforms: linux/amd64")
                && push.contains("&& 'prod'") && push.contains("&& 'linux/amd64'");

        System.out.println("  Dockerfile.x64 gone: " + noSecondFile);
        System.out.println("  prod and local both derive from the shared runtime stage: " + twoTargets);
        System.out.println("  One CDS training stage: " + sharedTraining);
        System.out.println("  Only the extractor pins a platform ($BUILDPLATFORM): " + onlyBuildPlatform);
        System.out.println("  compose builds target local: " + composeLocal);
        System.out.println("  workflows build target prod for linux/amd64: " + workflowsProd);
        System.out.println("  ✓ single Dockerfile layout verified");
        System.out.println("=".repeat(80));

        assertTrue(noSecondFile, "the production variant is the prod target of the single Dockerfile");
        assertTrue(twoTargets, "prod and local must both be final targets of the shared runtime stage");
        assertTrue(sharedTraining, "CDS training must happen once, in the shared cds-training stage");
        assertTrue(onlyBuildPlatform, "the target platform comes from the builder; only the extractor pins $BUILDPLATFORM");
        assertTrue(composeLocal, "docker-compose.yml must build the local target");
        assertTrue(workflowsProd, "the image workflows must build the prod target for linux/amd64");
    }
}
