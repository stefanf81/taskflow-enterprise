package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the CDS training and production-image decisions measured in BENCHMARKS.md §56.
 * The cold-start sweep itself is driven by {@code scripts/benchmark-cds-startup.sh}; this
 * test locks the adopted Dockerfile configuration so a future edit cannot silently revert
 * to the trimmed training context or re-ship the unused network tools.
 */
@Tag("benchmark")
class ContainerImageBenchmarkTest {

    @Test
    void cds_archive_trained_on_full_application() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ §56 CDS TRAINING (full application, offline, scrubbed env)");
        System.out.println("=".repeat(80));

        String d = Files.readString(Path.of("Dockerfile"));
        String dx = Files.readString(Path.of("Dockerfile.x64"));
        String md = Files.readString(Path.of("BENCHMARKS.md"));

        boolean fullApp = trainsFullApplication(d) && trainsFullApplication(dx);
        boolean noTrimmedContext = !d.contains("CdsTrainingApplication") && !dx.contains("CdsTrainingApplication")
                && !Files.exists(Path.of("src/main/java/com/example/cdstraining"));
        boolean documented = md.contains("## ⚡ 56.") && md.contains("benchmark-cds-startup.sh");
        boolean harness = Files.isRegularFile(Path.of("scripts/benchmark-cds-startup.sh"));

        System.out.println("  Both Dockerfiles train with -jar application.jar under env -i: " + fullApp);
        System.out.println("  Trimmed CdsTrainingApplication removed: " + noTrimmedContext);
        System.out.println("  §56 evidence in BENCHMARKS.md: " + documented);
        System.out.println("  Startup harness present: " + harness);
        System.out.println("  Measured medians (prod profile, 7 runs): no CDS 12.89 s, trimmed 9.35 s (69% classes), "
                + "full app 8.03 s (90% classes)");
        System.out.println("  ✓ §56 CDS training verified");
        System.out.println("=".repeat(80));

        assertTrue(fullApp, "both Dockerfiles must train CDS on the full app, offline, under env -i (§56)");
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
        String dx = Files.readString(Path.of("Dockerfile.x64"));

        boolean purged = dx.contains("apt-get purge -y --auto-remove curl wget gnupg");
        boolean setuidStripped = dx.contains("-perm /6000 -exec chmod a-s");
        boolean purgeBeforeUpgrade = purged
                && dx.indexOf("apt-get purge") < dx.indexOf("apt-get -y upgrade");
        boolean localKeepsWget = !d.contains("apt-get purge") && d.contains("CMD wget");

        System.out.println("  Dockerfile.x64 purges curl/wget/gnupg: " + purged);
        System.out.println("  Purge runs before the package refresh: " + purgeBeforeUpgrade);
        System.out.println("  setuid/setgid bits stripped: " + setuidStripped);
        System.out.println("  Local Dockerfile keeps wget for HEALTHCHECK: " + localKeepsWget);
        System.out.println("  Measured: 141 -> 109 packages, 11 -> 0 setuid binaries, Trivy 32 -> 31 CVEs");
        System.out.println("  ✓ §56 prod image slimming verified");
        System.out.println("=".repeat(80));

        assertTrue(purged, "Dockerfile.x64 must purge curl/wget/gnupg — the JVM uses none of them (§56)");
        assertTrue(purgeBeforeUpgrade, "purge before apt-get upgrade so removed packages are not refreshed");
        assertTrue(setuidStripped, "Dockerfile.x64 must strip setuid/setgid bits (§56)");
        assertTrue(localKeepsWget, "local Dockerfile HEALTHCHECK needs wget (P1-6 §47)");
    }

    private static boolean trainsFullApplication(String dockerfile) {
        return dockerfile.contains("RUN --network=none env -i ")
                && dockerfile.contains("-XX:ArchiveClassesAtExit=/tmp/application.jsa")
                && dockerfile.contains("-Dspring.context.exit=onRefresh")
                && dockerfile.contains("-jar application.jar \\");
    }
}
