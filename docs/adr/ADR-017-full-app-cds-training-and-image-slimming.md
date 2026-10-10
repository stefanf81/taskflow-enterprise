# ADR-017: Full-App CDS Training and Production Image Slimming

**Status:** Accepted

## Context

Application cold-start performance is critical for zero-downtime rolling updates and autoscaling. Standard Spring Boot 4.1 startup on JDK 21 without optimizations required ~12.9 seconds.

Earlier implementations utilized an isolated `CdsTrainingApplication` during the Docker build stage. However, because that warmup context excluded the JPA/Hibernate and Flyway persistence stack, it archived only 69% (16,371 / 23,706) of production classes, leaving 1,481 Hibernate, 529 Spring Data JPA, and 292 Flyway classes to be uncompressed and loaded from individual JAR files at runtime.

Additionally, the upstream `eclipse-temurin:21-jre-resolute` base image bundled unneeded utilities (`curl`, `wget`, `gnupg`), 11 setuid/setgid binaries, and an unmanaged static Go binary (`/usr/bin/pebble`) that introduced CVE scan failures (CVE-2026-97031/78667/78669).

## Decision

1. **Full-Application CDS Training:**
   - Both `Dockerfile` and `Dockerfile.x64` train the Class Data Sharing archive on the real `application.jar` in a dedicated multi-stage build step:
     ```dockerfile
     RUN --network=none env -i PATH="$PATH" LANG="$LANG" LC_ALL="$LC_ALL" \
         java -XX:ArchiveClassesAtExit=/tmp/application.jsa \
              -Dspring.context.exit=onRefresh \
              -Dspring.cache.type=redis \
              -Dotel.sdk.disabled=true \
              -jar application.jar \
         && test -s /tmp/application.jsa
     ```
   - Runs with `RUN --network=none` and default profile (in-memory H2) so Flyway migrations execute in memory without external infrastructure dependencies.
   - `spring.context.exit=onRefresh` halts execution immediately after the ApplicationContext finishes bean definition loading and class resolution, avoiding port binds, background tasks, or active connections.
   - `env -i PATH="$PATH" LANG="$LANG" LC_ALL="$LC_ALL"` strips BuildKit-injected environment variables (e.g., `OTEL_EXPORTER_OTLP_ENDPOINT=unix:///dev/otel-grpc.sock`) that would fail Spring Boot 4.1 OTLP initialization.
   - Deleted the obsolete `CdsTrainingApplication.java`.
2. **Production Image Hardening & Slimming (`Dockerfile.x64`):**
   - Purges `curl`, `wget`, and `gnupg` (and 30 transitive dependencies) before the package upgrade layer.
   - Removes setuid/setgid bits (`find / -xdev -type f -perm /6000 -exec chmod a-s {} +`).
   - Removes Canonical's unmanaged `/usr/bin/pebble` and `/var/lib/pebble`.
   - The local developer `Dockerfile` keeps `wget` for its local Docker `HEALTHCHECK`.

## Consequences

### Positive
- **Startup Speed:** Cold start dropped from **12.89 s** (no CDS) and **9.35 s** (trimmed training) to **8.03 s** (**90% of production startup classes** loaded directly from the shared archive, 21,322 / 23,611).
- **Reduced Attack Surface:** Attackers cannot use `curl` or `wget` for outbound data exfiltration or stage-2 payload retrieval.
- **Zero Fixable CVEs:** Eliminating unmanaged Go binaries and stripping packages achieved **0 fixable HIGH/CRITICAL vulnerabilities** on Trivy container scans.

### Negative
- **Build Duration:** Full CDS training adds ~9 seconds to the backend Docker build pipeline.
- **Archive Size:** The shared archive layer (`application.jsa`) adds ~38.7 MB gzip to the image distribution.
- **In-Container Troubleshooting:** Debugging production pods requires `kubectl debug` ephemeral containers rather than `kubectl exec ... curl`.

## Verification

- Benchmark: `BENCHMARKS.md §56` and `scripts/benchmark-cds-startup.sh`.
- Automated test: `src/test/java/com/example/taskflow/benchmark/ContainerImageBenchmarkTest.java` verifies CDS archive creation, base image invariants, and absence of vulnerable binaries.
