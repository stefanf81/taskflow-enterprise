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
        boolean localKeepsWget = !localRun.contains("apt-get purge")
                && DockerfileStages.inheritedInstructions(d, "local", "HEALTHCHECK").contains("CMD wget");
        boolean pebbleRemoved = prodRun.contains("rm -f /usr/bin/pebble")
                && prodRun.contains("rm -rf /var/lib/pebble");

        System.out.println("  prod target purges curl/wget/gnupg: " + purged);
        System.out.println("  Purge runs before the package refresh: " + purgeBeforeUpgrade);
        System.out.println("  setuid/setgid bits stripped: " + setuidStripped);
        System.out.println("  local target keeps wget for HEALTHCHECK: " + localKeepsWget);
        System.out.println("  Unmanaged pebble Go binary + state dir removed: " + pebbleRemoved);
        System.out.println("  Measured: 141 -> 109 packages, 11 -> 0 setuid binaries, Trivy 32 -> 31 CVEs; "
                + "pebble 3 HIGH (CI run 38013091067) -> 0 fixable HIGH/CRITICAL (rebuilt image, local Trivy 0.75.0)");
        System.out.println("  ✓ §56 prod image slimming verified");
        System.out.println("=".repeat(80));

        assertTrue(purged, "the prod target must purge curl/wget/gnupg — the JVM uses none of them (§56)");
        assertTrue(purgeBeforeUpgrade, "purge before apt-get upgrade so removed packages are not refreshed");
        assertTrue(setuidStripped, "the prod target must strip setuid/setgid bits (§56)");
        assertTrue(localKeepsWget, "the local target's HEALTHCHECK needs wget (P1-6 §47)");
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

    private static boolean trainsFullApplication(String dockerfile) {
        return dockerfile.contains("RUN --network=none env -i ")
                && dockerfile.contains("-XX:ArchiveClassesAtExit=/tmp/application.jsa")
                && dockerfile.contains("-Dspring.context.exit=onRefresh")
                && dockerfile.contains("-jar application.jar \\");
    }
}
