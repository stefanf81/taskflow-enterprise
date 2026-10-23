package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Tag;
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
 * <p>The nginx and diagnostics assertions used to live in {@link P1AndP2BenchmarkTest}, which
 * is tagged {@code benchmark}; no workflow runs {@code benchmarkTest}, so they never executed
 * in CI. Tagged {@code container-config}: they only read checked-in files, so they run in the
 * lightweight {@code containerConfigTest} task (CI backend job, and {@code check}) instead of
 * the Spring {@code test} suite.
 */
@Tag("container-config")
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

    /**
     * The security headers are declared once, at server level, and reach the caching locations
     * only through {@code add_header_inherit merge} (nginx 1.29.3+): without it, the
     * Cache-Control {@code add_header} of such a location drops every inherited header.
     */
    @Test
    void nginx_security_headers_are_declared_once_and_merged() throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        assertTrue(content.contains("add_header_inherit merge;"),
                "nginx.conf must merge the server-level security headers into locations with their own add_header");
        for (String header : List.of("X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security",
                "Permissions-Policy", "Cross-Origin-Opener-Policy")) {
            assertEquals(1, content.split("add_header " + header + " ", -1).length - 1,
                    header + " must be declared once (server level), not repeated per location");
        }
        assertEquals(1, content.split("include /etc/nginx/csp.conf;", -1).length - 1,
                "the CSP snippet must be included once (server level)");
    }

    /**
     * The guest landing is prerendered into index.html; every other route needs the
     * client-rendered index.csr.html, and so does `/` for a browser that has a session (it would
     * otherwise paint the guest page before redirecting). Both shells must stay revalidated.
     */
    @Test
    void nginx_serves_prerendered_landing_only_to_guests_on_root() throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        assertTrue(content.contains("try_files $uri $uri/ /index.csr.html;"),
                "client routes must fall back to the client-rendered shell, not the prerendered landing");
        assertTrue(content.contains("if ($cookie_access_token) {")
                        && content.contains("rewrite ^ /index.csr.html last;")
                        && content.contains("rewrite ^ /index.html last;"),
                "`/` must serve the client shell to a browser with a session cookie");
        assertTrue(content.contains("set $shell_vary \"\";")
                        && content.contains("set $shell_vary Cookie;")
                        && content.contains("add_header Vary $shell_vary always;"),
                "`/` depends on the Cookie header and must say so (Vary: Cookie), the other routes must not");
        assertTrue(content.contains("location ~ ^/index(?:\\.csr)?\\.html$ {")
                        && content.contains("add_header Cache-Control \"no-cache\" always;"),
                "both HTML shells must be revalidated on every load");
    }

    @Test
    void p1_2_jvm_diagnostics_flags() throws Exception {
        System.out.println("\n" + "=".repeat(80));
        System.out.println("  ▸ P1-2 JVM DIAGNOSTICS (HeapDump + GC log + UseContainerSupport)");
        System.out.println("=".repeat(80));
        Path compose = Path.of("docker-compose.yml");
        String yml = Files.readString(compose);
        long t0 = System.nanoTime();
        // Diagnostics go to the backend-diagnostics volume, not the /tmp tmpfs: tmpfs pages count
        // against the memory limit, and they are gone once ExitOnOutOfMemoryError stops the container.
        boolean hasHeapDump = yml.contains("HeapDumpOnOutOfMemoryError") && yml.contains("HeapDumpPath=/var/log/taskflow ");
        boolean hasGcLog = yml.contains("Xlog:gc*:file=/var/log/taskflow/gc.log:");
        boolean diagnosticsVolume = yml.contains("- backend-diagnostics:/var/log/taskflow")
                && yml.contains("\n  backend-diagnostics:");
        boolean noTmpDiagnostics = !yml.contains("HeapDumpPath=/tmp") && !yml.contains("file=/tmp/gc.log");
        boolean hasContainer = yml.contains("UseContainerSupport");
        boolean hasUseG1GC = yml.contains("UseG1GC");
        long us = (System.nanoTime() - t0) / 1000;

        System.out.println("  HeapDump flag: " + hasHeapDump);
        System.out.println("  GC log flag: " + hasGcLog);
        System.out.println("  Diagnostics on the backend-diagnostics volume, none on tmpfs: "
                + (diagnosticsVolume && noTmpDiagnostics));
        System.out.println("  UseContainerSupport: " + hasContainer);
        System.out.println("  UseG1GC preserved: " + hasUseG1GC);
        System.out.printf("  Parse latency: %d µs%n", us);

        assertTrue(hasHeapDump, "docker-compose must dump the heap on OOM into /var/log/taskflow");
        assertTrue(hasGcLog, "must have Xlog:gc*:file=/var/log/taskflow/gc.log");
        assertTrue(diagnosticsVolume, "/var/log/taskflow must be the backend-diagnostics named volume");
        assertTrue(noTmpDiagnostics, "no heap dump or GC log on the /tmp tmpfs (memory-charged, lost on stop)");
        assertTrue(hasContainer, "UseContainerSupport explicit");
        assertTrue(hasUseG1GC, "G1GC must remain");

        String d = Files.readString(Path.of("Dockerfile"));
        boolean localHealthcheck = !DockerfileStages.inheritedInstructions(d, "local", "HEALTHCHECK").isEmpty();
        // prod is k8s — variables & probes are set in homelab/TF YAML, not the Dockerfile. A
        // HEALTHCHECK is inherited, so no stage in prod's ancestry may carry one either.
        boolean prodHealthcheck = !DockerfileStages.inheritedInstructions(d, "prod", "HEALTHCHECK").isEmpty();
        assertTrue(localHealthcheck, "the local target needs a HEALTHCHECK (P1-6 local)");
        assertFalse(prodHealthcheck, "the prod target must not have a HEALTHCHECK — k8s uses livenessProbe via yaml");
        // Probe every 2 s during the start period instead of waiting a full interval (Engine 25+).
        String localCheck = DockerfileStages.inheritedInstructions(d, "local", "HEALTHCHECK");
        assertTrue(localCheck.contains("--start-period=60s") && localCheck.contains("--start-interval=2s"),
                "the local HEALTHCHECK must probe every 2 s during a 60 s start period, like docker-compose.yml");
        // A fresh named volume copies the mount point's ownership: the non-root JVM can only
        // write its diagnostics if the image creates the directory owned by the runtime user.
        String runtimeRun = DockerfileStages.instructions(d, "runtime", "RUN");
        assertTrue(runtimeRun.contains("install -d -o 10001 -g 10001 -m 0750 /var/log/taskflow"),
                "the shared runtime stage must create /var/log/taskflow owned by 10001");

        System.out.println("  Overhead: GC log ~0.7% at 10% sampling per §7, heap dump 0% until OOM");
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
        boolean twoTargets = "runtime".equals(DockerfileStages.parent(d, "prod"))
                && "runtime".equals(DockerfileStages.parent(d, "local"));
        boolean sharedTraining = DockerfileStages.instructions(d, "cds-training", "RUN")
                .contains("-XX:AOTCacheOutput=/tmp/application.aot");
        // tini is installed once, in the shared runtime stage, before the application layers:
        // a new JAR must not invalidate the apt layer (local rebuilds stay cached and offline).
        List<String> runtime = DockerfileStages.instructions(d, "runtime");
        int tiniInstall = indexOf(runtime, i -> i.startsWith("RUN ") && i.contains("install") && i.contains("tini"));
        int firstCopy = indexOf(runtime, i -> i.startsWith("COPY "));
        boolean tiniBeforeLayers = tiniInstall >= 0 && firstCopy >= 0 && tiniInstall < firstCopy;
        boolean localNoApt = !DockerfileStages.instructions(d, "local", "RUN").contains("apt-get");
        boolean localIsDefault = "local".equals(DockerfileStages.finalStage(d));
        List<String> platformFroms = d.lines().filter(line -> line.startsWith("FROM --platform=")).toList();
        boolean onlyBuildPlatform = !d.contains("ARG PLATFORM")
                && platformFroms.equals(List.of("FROM --platform=$BUILDPLATFORM ${JAVA_IMAGE} AS extractor"));
        boolean composeLocal = compose.contains("target: local");
        boolean workflowsProd = ci.contains("target: prod") && ci.contains("platforms: linux/amd64")
                && push.contains("&& 'prod'") && push.contains("&& 'linux/amd64'");

        System.out.println("  Dockerfile.x64 gone: " + noSecondFile);
        System.out.println("  prod and local both derive from the shared runtime stage: " + twoTargets);
        System.out.println("  One AOT cache training stage: " + sharedTraining);
        System.out.println("  tini installed in runtime before the application layers: " + tiniBeforeLayers);
        System.out.println("  local target runs no apt: " + localNoApt);
        System.out.println("  local is the default (last) stage: " + localIsDefault);
        System.out.println("  Only the extractor pins a platform ($BUILDPLATFORM): " + onlyBuildPlatform);
        System.out.println("  compose builds target local: " + composeLocal);
        System.out.println("  workflows build target prod for linux/amd64: " + workflowsProd);
        System.out.println("  ✓ single Dockerfile layout verified");
        System.out.println("=".repeat(80));

        assertTrue(noSecondFile, "the production variant is the prod target of the single Dockerfile");
        assertTrue(twoTargets, "prod and local must both be final targets of the shared runtime stage");
        assertTrue(sharedTraining, "AOT cache training must happen once, in the shared cds-training stage");
        assertTrue(tiniBeforeLayers, "install tini in the runtime stage before the COPY layers, "
                + "or every JAR change re-runs apt");
        assertTrue(localNoApt, "the local target must not run apt (cached, offline rebuilds)");
        assertTrue(localIsDefault, "local must stay the last stage: an untargeted build must work "
                + "with the compose healthcheck, which needs wget");
        assertTrue(onlyBuildPlatform, "the target platform comes from the builder; only the extractor pins $BUILDPLATFORM");
        assertTrue(composeLocal, "docker-compose.yml must build the local target");
        assertTrue(workflowsProd, "the image workflows must build the prod target for linux/amd64");
    }

    private static int indexOf(List<String> instructions, java.util.function.Predicate<String> match) {
        for (int i = 0; i < instructions.size(); i++) {
            if (match.test(instructions.get(i))) {
                return i;
            }
        }
        return -1;
    }
}
