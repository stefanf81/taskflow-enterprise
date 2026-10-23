package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the CDS training and production-image decisions measured in BENCHMARKS.md §56.
 * The cold-start sweep itself is driven by {@code scripts/benchmark-cds-startup.sh}; this
 * test locks the adopted Dockerfile configuration so a future edit cannot silently revert
 * to the trimmed training context or re-ship the unused network tools.
 *
 * <p>Tagged {@code container-config}: it only reads checked-in files, so it runs in the
 * lightweight {@code containerConfigTest} task (CI backend job, and {@code check}), whose
 * declared inputs re-run it on a Dockerfile, compose, nginx or workflow edit without
 * invalidating the Spring {@code test} suite.
 */
@Tag("container-config")
class ContainerImageBenchmarkTest {

    @Test
    void cds_archive_trained_on_full_application() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ §56 CDS TRAINING (full application, offline, scrubbed env)");
        System.out.println("=".repeat(80));

        String d = Files.readString(Path.of("Dockerfile"));
        String md = Files.readString(Path.of("BENCHMARKS.md"));

        boolean fullApp = trainsFullApplication(d);
        boolean noTrimmedContext = !d.contains("CdsTrainingApplication")
                && !Files.exists(Path.of("src/main/java/com/example/cdstraining"));
        boolean documented = md.contains("## ⚡ 56.") && md.contains("benchmark-cds-startup.sh");
        boolean harness = Files.isRegularFile(Path.of("scripts/benchmark-cds-startup.sh"));

        System.out.println("  The Dockerfile trains with -jar application.jar under env -i: " + fullApp);
        System.out.println("  Trimmed CdsTrainingApplication removed: " + noTrimmedContext);
        System.out.println("  §56 evidence in BENCHMARKS.md: " + documented);
        System.out.println("  Startup harness present: " + harness);
        System.out.println("  Measured medians (prod profile, 7 runs): no CDS 12.89 s, trimmed 9.35 s (69% classes), "
                + "full app 8.03 s (90% classes)");
        System.out.println("  ✓ §56 CDS training verified");
        System.out.println("=".repeat(80));

        assertTrue(fullApp, "the Dockerfile must train CDS on the full app, offline, under env -i (§56)");
        assertTrue(noTrimmedContext, "the trimmed CdsTrainingApplication missed ~30% of prod startup classes (§56)");
        assertTrue(documented, "BENCHMARKS.md must document the CDS training measurement (§56)");
        assertTrue(harness, "scripts/benchmark-cds-startup.sh must remain for re-measurement");
    }

    @Test
    void prod_image_drops_unused_network_tools_and_setuid_bits() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ §56 PROD IMAGE SLIMMING (curl/wget/gnupg purged, setuid stripped)");
        System.out.println("=".repeat(80));

        String d = Files.readString(Path.of("Dockerfile"));
        // Inherited instructions count: a purge moved into the shared runtime stage would
        // strip wget from the local image too, and must fail the local assertion below.
        String prodRun = DockerfileStages.inheritedInstructions(d, "prod", "RUN");
        String localRun = DockerfileStages.inheritedInstructions(d, "local", "RUN");

        boolean purged = prodRun.contains("apt-get purge -y --auto-remove curl wget gnupg");
        boolean setuidStripped = prodRun.contains("-perm /6000 -exec chmod a-s");
        boolean purgeBeforeUpgrade = purged
                && prodRun.indexOf("apt-get purge") < prodRun.indexOf("apt-get -y upgrade");
        // The Java 25 base ships no wget (§62): the local image must install it, not just
        // avoid purging it, or every compose health check fails.
        boolean localKeepsWget = !localRun.contains("apt-get purge")
                && Pattern.compile("apt-get install[^&]*\\bwget\\b").matcher(localRun).find()
                && DockerfileStages.inheritedInstructions(d, "local", "HEALTHCHECK").contains("CMD wget");
        boolean pebbleRemoved = prodRun.contains("rm -f /usr/bin/pebble")
                && prodRun.contains("rm -rf /var/lib/pebble");

        System.out.println("  prod target purges curl/wget/gnupg: " + purged);
        System.out.println("  Purge runs before the package refresh: " + purgeBeforeUpgrade);
        System.out.println("  setuid/setgid bits stripped: " + setuidStripped);
        System.out.println("  local target installs and keeps wget for HEALTHCHECK: " + localKeepsWget);
        System.out.println("  Unmanaged pebble Go binary + state dir removed: " + pebbleRemoved);
        System.out.println("  Measured: 141 -> 109 packages, 11 -> 0 setuid binaries, Trivy 32 -> 31 CVEs; "
                + "pebble 3 HIGH (CI run 38013091067) -> 0 fixable HIGH/CRITICAL (rebuilt image, local Trivy 0.75.0)");
        System.out.println("  ✓ §56 prod image slimming verified");
        System.out.println("=".repeat(80));

        assertTrue(purged, "the prod target must purge curl/wget/gnupg — the JVM uses none of them (§56)");
        assertTrue(purgeBeforeUpgrade, "purge before apt-get upgrade so removed packages are not refreshed");
        assertTrue(setuidStripped, "the prod target must strip setuid/setgid bits (§56)");
        assertTrue(localKeepsWget, "the local target's HEALTHCHECK needs wget, installed in an "
                + "inherited stage because the Java 25 base has none (P1-6 §47, §62)");
        assertTrue(pebbleRemoved, "the prod target must remove the unmanaged pebble Go binary — "
                + "apt cannot patch its Go stdlib (CVE-2026-97031/78667/78669) and the Trivy gate is HIGH/CRITICAL");
    }

    @Test
    void apt_index_refresh_fails_on_any_fetch_error() throws Exception {
        String d = Files.readString(Path.of("Dockerfile"));
        // Without --error-on=any a failed index download is only a warning: `apt-get update`
        // exits 0, the runtime stage's lists are already deleted, and the prod upgrade then
        // succeeds without applying the updates from the repositories it could not reach.
        for (String target : List.of("prod", "local")) {
            String run = DockerfileStages.inheritedInstructions(d, target, "RUN");
            long refreshes = Pattern.compile("apt-get update\\b").matcher(run).results().count();
            long strict = Pattern.compile("apt-get update --error-on=any\\b").matcher(run).results().count();

            System.out.println("  " + target + ": " + strict + " of " + refreshes
                    + " apt-get update calls use --error-on=any");

            assertTrue(refreshes > 0, "the " + target + " target must refresh the package index (tini install)");
            assertEquals(refreshes, strict,
                    "every apt-get update in the " + target + " target must use --error-on=any");
        }
    }

    @Test
    void java25_aot_cache_replaces_cds_archive() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ §62 JAVA 25 AOT CACHE (JEP 483/514/515)");
        System.out.println("=".repeat(80));

        String d = Files.readString(Path.of("Dockerfile"));
        String md = Files.readString(Path.of("BENCHMARKS.md"));
        String runtimeCmd = DockerfileStages.instructions(d, "runtime", "CMD");

        boolean trainedWithG1 = DockerfileStages.instructions(d, "cds-training", "RUN")
                .contains("java -XX:+UseG1GC -XX:AOTCacheOutput=/tmp/application.aot");
        boolean launched = runtimeCmd.contains("\"-XX:AOTCache=application.aot\"")
                && !runtimeCmd.contains("AOTMode");
        boolean bothValidate = List.of("prod", "local").stream().allMatch(target -> DockerfileStages
                .instructions(d, target, "RUN")
                .contains("-XX:+UseG1GC -XX:AOTMode=on -XX:AOTCache=application.aot"));
        boolean noCdsLeftovers = hasNoLegacyArchiveInstructions(d);
        boolean documented = md.contains("## ⚡ 62.");

        System.out.println("  Trained once with -XX:AOTCacheOutput under G1: " + trainedWithG1);
        System.out.println("  CMD loads the cache in the default AOTMode=auto: " + launched);
        System.out.println("  prod and local boot-validate with -XX:AOTMode=on: " + bothValidate);
        System.out.println("  No CDS archive flags left: " + noCdsLeftovers);
        System.out.println("  §62 evidence in BENCHMARKS.md: " + documented);
        System.out.println("  Measured medians (prod profile, 7 runs): Java 21 + CDS 3.19 s, "
                + "Java 25 + CDS 3.23 s, Java 25 + AOT cache 2.67 s");
        System.out.println("=".repeat(80));

        assertTrue(trainedWithG1, "train the AOT cache in cds-training with G1, the runtime collector (§62)");
        assertTrue(launched, "the image CMD must load application.aot and keep the auto fallback (§62)");
        assertTrue(bothValidate, "both targets must boot the app with -XX:AOTMode=on to validate the cache (§58, §62)");
        assertTrue(noCdsLeftovers, "the AOT cache replaces the dynamic CDS archive; do not ship both (§62)");
        assertTrue(documented, "BENCHMARKS.md must document the Java 25 measurement (§62)");
    }

    @Test
    void legacy_archive_guard_ignores_comments_but_checks_instructions() throws Exception {
        String d = Files.readString(Path.of("Dockerfile"));
        String historicalComment = "# Previously: application.jsa -Xshare:on -XX:ArchiveClassesAtExit\n";
        assertTrue(hasNoLegacyArchiveInstructions(historicalComment + d),
                "historical comments must not trip the archive instruction guard");
        assertFalse(hasNoLegacyArchiveInstructions(d.replace(
                "\"-XX:AOTCache=application.aot\"", "\"-Xshare:auto\"")),
                "legacy flags in the runtime CMD must still fail");
        assertFalse(hasNoLegacyArchiveInstructions(d.replace(
                "AOTCacheOutput=/tmp/application.aot", "ArchiveClassesAtExit=/tmp/application.aot")),
                "legacy flags in the training RUN must still fail");
        assertFalse(hasNoLegacyArchiveInstructions(d.replace(
                "/tmp/application.aot ./application.aot", "/tmp/application.jsa ./application.jsa")),
                "copying the former archive must still fail");
    }

    private static boolean hasNoLegacyArchiveInstructions(String dockerfile) {
        return List.of("extractor", "java-base", "cds-training", "runtime", "prod", "local").stream()
                .flatMap(stage -> DockerfileStages.instructions(dockerfile, stage).stream())
                .noneMatch(instruction -> instruction.contains("application.jsa")
                        || instruction.contains("-Xshare:")
                        || instruction.contains("ArchiveClassesAtExit"));
    }

    private static boolean trainsFullApplication(String dockerfile) {
        return dockerfile.contains("RUN --network=none env -i ")
                && dockerfile.contains("-XX:AOTCacheOutput=/tmp/application.aot")
                && dockerfile.contains("-Dspring.context.exit=onRefresh")
                && dockerfile.contains("-jar application.jar \\");
    }
}
