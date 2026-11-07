package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the container configuration decisions measured in BENCHMARKS.md §42, §43, §47 and
 * §56: the split nginx cache locations, the deployment-owned JVM diagnostics in
 * docker-compose.yml, the HEALTHCHECK that only the Dockerfile's {@code local} target carries,
 * the single-Dockerfile layout whose target platform is chosen by the builder, and the compose
 * proxy subnet, readiness gate, Redis eviction policy and loopback-only datastore ports.
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
     * Spring Security writes some of the same headers (X-Frame-Options, X-Content-Type-Options,
     * Cross-Origin-Resource-Policy, HSTS on HTTPS). add_header appends, and two CORP fields
     * combine into an invalid value that browsers ignore, so every header nginx sets must be
     * hidden from the upstream response, once, at server level (both proxy locations inherit it).
     */
    @Test
    void nginx_hides_upstream_copies_of_its_own_security_headers() throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        List<String> nginxHeaders = new java.util.ArrayList<>(content.lines()
                .map(String::strip)
                .filter(line -> line.startsWith("add_header ") && line.endsWith(" always;"))
                .map(line -> line.split("\\s+")[1])
                .filter(name -> !List.of("Cache-Control", "Vary", "Last-Modified").contains(name))
                .distinct()
                .toList());
        nginxHeaders.add("Content-Security-Policy"); // from the generated csp.conf include
        assertTrue(nginxHeaders.containsAll(List.of("X-Frame-Options", "X-Content-Type-Options",
                "Cross-Origin-Resource-Policy", "Strict-Transport-Security")), "parsed " + nginxHeaders);
        for (String header : nginxHeaders) {
            assertEquals(1, content.split("proxy_hide_header " + header + ";", -1).length - 1,
                    header + " is set by nginx, so the upstream copy must be hidden exactly once (server level)");
        }
        for (String location : List.of("location = /api/v1/appointments/events {", "location ^~ /api/ {")) {
            assertFalse(block(content, location).contains("proxy_hide_header"),
                    location + " must inherit the server-level proxy_hide_header list, not replace it");
        }
    }

    /**
     * Without {@code always}, add_header skips error statuses: a 404 for a chunk removed by a
     * rolling deploy or rollback must not be cached immutable for 6 months.
     */
    @Test
    void nginx_long_lived_cache_control_skips_error_responses() throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        assertTrue(content.contains("add_header Cache-Control \"public, immutable, max-age=15552000\";"),
                "hashed bundles: immutable Cache-Control without `always`");
        assertTrue(content.contains("add_header Cache-Control \"public, max-age=3600, must-revalidate\";"),
                "unhashed assets: Cache-Control without `always`");
        assertFalse(content.contains("max-age=15552000\" always;") || content.contains("must-revalidate\" always;"),
                "`always` would also cache 404s for missing assets");
    }

    @Test
    void nginx_api_proxy_is_isolated_and_bounded() throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        assertFalse(content.contains("location /api/ {"),
                "a plain prefix lets the static-asset regex locations capture /api/... .js or .png");
        String api = block(content, "location ^~ /api/ {");
        assertTrue(api.contains("proxy_connect_timeout 5s;") && api.contains("proxy_read_timeout 30s;"),
                "the JSON API must not wait nginx's 60 s defaults for a hung backend");
        assertTrue(api.contains("error_page 502 503 504 @api_unavailable;"),
                "nginx's own 502/503/504 must keep their status and come back as JSON");
        String problem = block(content, "location @api_unavailable {");
        assertTrue(problem.contains("types { }") && problem.contains("default_type application/problem+json;")
                        && problem.contains("\"status\":$status"),
                "the API error body must be RFC 9457 problem JSON carrying the original status");
        assertFalse(problem.contains("add_header"), "the error location must keep the server-level headers");

        String sse = block(content, "location = /api/v1/appointments/events {");
        assertTrue(sse.contains("proxy_read_timeout 1h;") && sse.contains("proxy_buffering off;"),
                "the SSE stream keeps its unbuffered, long-lived proxy (ADR-009)");
        assertFalse(sse.contains("error_page"), "the SSE location is not part of the JSON error mapping");
    }

    /**
     * nginx refuses to start ("directive is duplicate") when a single-value directive repeats in
     * one block, and an error_page aimed at a missing named location fails every such response.
     * A string-level check, since the image is not started by this task.
     */
    @Test
    void nginx_blocks_declare_single_value_directives_once_and_error_pages_target_real_locations()
            throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        List<String> singleValue = List.of("client_max_body_size", "proxy_pass", "proxy_http_version",
                "proxy_connect_timeout", "proxy_read_timeout", "proxy_send_timeout", "proxy_buffer_size",
                "proxy_buffers", "proxy_buffering", "default_type", "root", "index", "return");
        java.util.regex.Matcher opening = java.util.regex.Pattern.compile("(?m)^\\s*(location|server)\\b[^{;]*\\{")
                .matcher(content);
        while (opening.find()) {
            String header = opening.group().strip();
            String body = block(content.substring(opening.start()), header);
            List<String> topLevel = topLevelDirectives(body.substring(body.indexOf('{') + 1, body.length() - 1));
            for (String name : singleValue) {
                long count = topLevel.stream().filter(d -> d.equals(name) || d.startsWith(name + " ")).count();
                assertTrue(count <= 1, name + " is declared " + count + " times in `" + header + "`");
            }
        }

        String api = block(content, "location ^~ /api/ {");
        assertTrue(api.contains("client_max_body_size 32k;") && api.contains("error_page 413 @api_unavailable;"),
                "the API bounds request bodies and answers 413 as problem JSON");
        java.util.regex.Matcher target = java.util.regex.Pattern.compile("error_page[^;]*\\s(@[A-Za-z0-9_]+);")
                .matcher(content);
        while (target.find()) {
            assertTrue(content.contains("location " + target.group(1) + " {"),
                    "error_page targets a missing named location " + target.group(1));
        }
        String titles = block(content, "map $status $api_problem_title {");
        assertTrue(titles.contains("413") && titles.contains("502") && titles.contains("504"),
                "every status mapped to @api_unavailable has a problem title");
    }

    /** The directives directly inside a block body: nested blocks and comments removed. */
    private static List<String> topLevelDirectives(String body) {
        StringBuilder flat = new StringBuilder();
        int depth = 0;
        for (String line : body.lines().map(l -> l.replaceAll("#.*$", "")).toList()) {
            for (char c : line.toCharArray()) {
                if (c == '{') {
                    depth++;
                    // A nested block ends the directive that opened it.
                    if (depth == 1) {
                        flat.append(';');
                    }
                } else if (c == '}') {
                    depth--;
                } else if (depth == 0) {
                    flat.append(c);
                }
            }
            flat.append(' ');
        }
        return java.util.Arrays.stream(flat.toString().split(";"))
                .map(s -> s.strip().replaceAll("\\s+", " "))
                .filter(s -> !s.isEmpty())
                .toList();
    }

    /**
     * The image listens on plain HTTP, so $scheme would override a TLS ingress's https. The
     * ingress's X-Forwarded-Proto is honoured only when real-ip.conf trusted the peer.
     */
    @Test
    void nginx_forwards_the_ingress_scheme_only_from_trusted_peers() throws Exception {
        String content = Files.readString(Path.of("frontend/nginx.conf"));
        assertFalse(content.contains("X-Forwarded-Proto $scheme;"), "$scheme hides the ingress's https");
        assertEquals(2, content.split(java.util.regex.Pattern.quote("proxy_set_header X-Forwarded-Proto $forwarded_proto;"), -1).length - 1,
                "both proxy locations must forward $forwarded_proto");
        assertTrue(content.contains("set $forwarded_proto $scheme;")
                        && content.contains("if ($realip_remote_addr != $remote_addr) {")
                        && content.contains("set $forwarded_proto $trusted_forwarded_proto;"),
                "the forwarded header may only replace $scheme for a peer the realip module trusted");
        assertTrue(content.indexOf("include /etc/nginx/real-ip.conf;") < content.indexOf("set $forwarded_proto $scheme;"),
                "the real-ip settings belong to the server block that evaluates the trust check");
        String map = block(content, "map $http_x_forwarded_proto $trusted_forwarded_proto {");
        assertTrue(map.contains("default $scheme;") && map.contains("https   https;"),
                "only http/https are accepted from the ingress");
    }

    /**
     * The resolver lives in the mounted upstream file with the server address, so a deployment
     * that replaces the file controls both. Each http-level setting is declared once.
     */
    @Test
    void nginx_upstream_file_owns_its_resolver_and_http_settings_are_not_duplicated() throws Exception {
        String main = Files.readString(Path.of("frontend/nginx-main.conf"));
        String server = Files.readString(Path.of("frontend/nginx.conf"));
        String upstream = Files.readString(Path.of("frontend/nginx-upstream-server.conf"));
        String ci = Files.readString(Path.of("frontend/nginx-upstream-server-ci.conf"));
        assertFalse(directives(main).anyMatch(line -> line.startsWith("resolver ")),
                "no http-level resolver: it belongs to the mounted upstream file");
        assertTrue(upstream.contains("resolver 127.0.0.11 ipv6=off valid=30s;")
                        && upstream.contains("server backend:8080 resolve;"),
                "the Compose upstream resolves the backend at run time through Docker's DNS");
        assertTrue(directives(ci).noneMatch(line -> line.startsWith("resolver ") || line.contains(" resolve")),
                "the CI upstream is resolved once at startup (--add-host)");
        assertTrue(server.contains("include /etc/nginx/upstream-server.conf;"));

        for (String directive : List.of("sendfile ", "tcp_nopush ", "tcp_nodelay ", "keepalive_timeout 65;")) {
            assertTrue(directives(main).anyMatch(line -> line.startsWith(directive)), directive + " in nginx-main.conf");
            assertTrue(directives(server).noneMatch(line -> line.startsWith(directive)),
                    directive + " is http-level, set once in nginx-main.conf");
        }
        assertFalse(server.contains("gzip_disable"), "no MSIE 6 workaround");
        assertFalse(server.contains("proxy_cache off;"), "proxy_cache is off by default and never enabled");
    }

    /** The text between a block's opening line and its matching closing brace. */
    private static String block(String content, String opening) {
        int start = content.indexOf(opening);
        assertTrue(start >= 0, "missing block: " + opening);
        int depth = 0;
        for (int i = start + opening.length() - 1; i < content.length(); i++) {
            char c = content.charAt(i);
            if (c == '{') {
                depth++;
            } else if (c == '}' && --depth == 0) {
                return content.substring(start, i + 1);
            }
        }
        throw new AssertionError("unterminated block: " + opening);
    }

    /** Non-comment lines, stripped. */
    private static java.util.stream.Stream<String> directives(String content) {
        return content.lines().map(String::strip).filter(line -> !line.isEmpty() && !line.startsWith("#"));
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
        assertTrue(content.contains("if ($cookie_taskflow_session) {"),
                "a browser that can renew its session (expired access cookie) is no guest either");
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

    /**
     * Tomcat's RemoteIpValve trusts X-Forwarded-For only from addresses matching
     * APP_TRUSTED_PROXY_REGEX. The regex is only meaningful against a pinned frontend-tier
     * subnet: left to Docker's address pools, the Nginx container could land anywhere in
     * 172.17-31/16 or 192.168/16.
     */
    @Test
    void compose_trusts_forwarding_headers_only_from_the_pinned_frontend_subnet() throws Exception {
        String yml = Files.readString(Path.of("docker-compose.yml"));
        String prefix = "- APP_TRUSTED_PROXY_REGEX=";
        List<String> regexes = yml.lines().map(String::strip).filter(line -> line.startsWith(prefix))
                .map(line -> line.substring(prefix.length())).toList();
        assertEquals(1, regexes.size(), "the backend must set APP_TRUSTED_PROXY_REGEX exactly once");
        assertTrue(yml.contains("""
                  frontend-tier:
                    driver: bridge
                    ipam:
                      config:
                        - subnet: 172.30.0.0/24
                """), "frontend-tier must pin the subnet the proxy regex trusts");
        assertTrue(yml.contains("""
                  backend-tier:
                    driver: bridge
                    ipam:
                      config:
                        - subnet: 172.30.1.0/24
                """), "backend-tier must be pinned too, or its automatic pool may overlap frontend-tier");

        Pattern trusted = Pattern.compile(regexes.getFirst());
        for (String proxy : List.of("172.30.0.2", "172.30.0.254")) {
            assertTrue(trusted.matcher(proxy).matches(), "the regex must match frontend-tier address " + proxy);
        }
        for (String other : List.of("172.30.1.2", "172.18.0.3", "172.31.0.2", "192.168.0.2", "127.0.0.1",
                "172.30.0.2.5")) {
            assertFalse(trusted.matcher(other).matches(), "the regex must not trust " + other);
        }
    }

    /**
     * Compose-only runtime decisions: the frontend waits for readiness (set after the
     * CommandLineRunners and ApplicationReadyEvent listeners), Redis never evicts the
     * revocation/throttle keys, and only the frontend is published beyond loopback.
     */
    @Test
    void compose_gates_on_readiness_never_evicts_and_publishes_datastores_on_loopback() throws Exception {
        String yml = Files.readString(Path.of("docker-compose.yml"));
        assertTrue(yml.contains("\"http://localhost:8080/actuator/health/readiness\"]"),
                "the compose backend healthcheck must probe readiness");
        assertFalse(yml.contains("/actuator/health/liveness\"]"),
                "liveness is UP before the admin sync runs; the compose healthcheck must not use it");

        assertTrue(yml.contains("- \"--maxmemory-policy\"\n      - \"noeviction\""),
                "Redis must not evict: every key has a TTL, so volatile-* would drop revoked:<jti> too");
        assertFalse(yml.contains("- \"volatile-") || yml.contains("- \"allkeys-"), "no evicting maxmemory-policy");

        Pattern published = Pattern.compile("^\\s+- \"([0-9.]+:)?\\d+:\\d+\"");
        List<String> ports = yml.lines().filter(line -> published.matcher(line).find())
                .map(line -> line.strip().split("\\s+#")[0]).toList();
        assertFalse(ports.isEmpty(), "expected published ports in docker-compose.yml");
        for (String port : ports) {
            assertTrue(port.startsWith("- \"127.0.0.1:") || port.equals("- \"4200:8080\""),
                    "only the frontend may be published beyond loopback, found " + port);
        }
    }

    /**
     * https://github.com/stefanf81/taskflow-enterprise/issues/218: Redis keeps the token denylist across
     * a restart (append-only file on the redisdata volume); the backend's PostgreSQL copy only closes
     * the remaining window.
     */
    @Test
    void compose_persists_redis_with_an_append_only_file() throws Exception {
        String yml = Files.readString(Path.of("docker-compose.yml"));
        String redis = composeService(yml, "redis");
        assertTrue(redis.contains("- \"--appendonly\"\n      - \"yes\""), "Redis must run with --appendonly yes");
        assertTrue(redis.contains("- \"--appendfsync\"\n      - \"everysec\""), "Redis must fsync the AOF every second");
        assertTrue(redis.contains("- redisdata:/data"), "the AOF must live on the redisdata volume");
    }

    /** One top-level service of docker-compose.yml: from its "  name:" line to the next service. */
    private static String composeService(String yml, String name) {
        String opening = "\n  " + name + ":\n";
        int start = yml.indexOf(opening);
        assertTrue(start >= 0, "missing compose service: " + name);
        Matcher next = Pattern.compile("\\n  [a-z][\\w-]*:\\n|\\nvolumes:\\n|\\nnetworks:\\n")
                .matcher(yml).region(start + opening.length(), yml.length());
        return yml.substring(start, next.find() ? next.start() : yml.length());
    }

    /**
     * https://github.com/stefanf81/taskflow-enterprise/issues/217: {@code env_file: .env} also handed the
     * database the JWT private key, the admin password and every other application secret.
     */
    @Test
    void compose_gives_the_database_only_its_own_variables() throws Exception {
        String db = composeService(Files.readString(Path.of("docker-compose.yml")), "db");
        assertTrue(db.lines().map(String::strip).filter(line -> !line.startsWith("#"))
                        .noneMatch(line -> line.startsWith("env_file")),
                "the db service must not import the whole .env");
        List<String> variables = db.lines().map(String::strip)
                .filter(line -> line.startsWith("- ") && line.matches("- [A-Z][A-Z0-9_]*=.*"))
                .map(line -> line.substring(2, line.indexOf('='))).toList();
        assertEquals(List.of("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"), variables,
                "the db service needs exactly the variables the postgres image reads");
    }

    /**
     * https://github.com/stefanf81/taskflow-enterprise/issues/216: the official image runs with
     * protected-mode off, so without a password anything that reaches the port can flush the
     * rate-limit counters or forge entries in the token denylist and the caches. The backend reads the
     * same value as REDIS_PASSWORD from .env.
     */
    @Test
    void compose_protects_redis_with_the_password_the_backend_sends() throws Exception {
        String yml = Files.readString(Path.of("docker-compose.yml"));
        String redis = composeService(yml, "redis");
        assertTrue(redis.contains("- \"--requirepass\"\n      - \"${REDIS_PASSWORD}\""),
                "Redis must start with --requirepass ${REDIS_PASSWORD}");
        assertTrue(redis.contains("- REDISCLI_AUTH=${REDIS_PASSWORD}"),
                "redis-cli (the healthcheck) authenticates through REDISCLI_AUTH");
        assertTrue(redis.contains("redis-cli ping | grep -q PONG"),
                "the healthcheck must see PONG: redis-cli exits 0 on a NOAUTH reply");
        assertTrue(composeService(yml, "backend").contains("env_file:\n      - .env"),
                "the backend reads REDIS_PASSWORD from .env");
        assertTrue(Files.readString(Path.of(".env.example")).lines().anyMatch(line -> line.startsWith("REDIS_PASSWORD=")),
                ".env.example must list REDIS_PASSWORD");
        assertTrue(Files.readString(Path.of("src/main/resources/application-prod.properties"))
                        .contains("spring.data.redis.password=${REDIS_PASSWORD}"),
                "the prod profile must send the password, without a default");
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
