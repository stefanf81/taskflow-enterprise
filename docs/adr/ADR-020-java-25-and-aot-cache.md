# ADR-020: Java 25 LTS with an AOT Cache Instead of the CDS Archive

**Status:** Latest-available digest-pinned runtime candidate accepted; production risk approval and native amd64 validation pending (BENCHMARKS.md §62).

Production approval is **operator-controlled policy**, not an automated CI or publication interlock. The manual publication workflow can still publish this candidate; operators must complete the checklist before production promotion in the separate GitOps repository.

## Context

The backend ran on Java 21 (`eclipse-temurin:21-jre-resolute`) with a dynamic CDS archive trained on the full application at image build time (ADR-017). Java 25 is the next LTS. Two earlier measurements stood in the way:

- BENCHMARKS.md §58 measured 5–8% lower throughput on JDK 25 (amd64, boot JAR without a startup archive) and asked for a comparison before moving.
- BENCHMARKS.md §56 deferred the AOT cache (JEP 483/514/515), the successor of the dynamic CDS archive, until the project adopted Java 25.

BENCHMARKS.md §62 re-measured both on the full stack, with the Java 21 image interleaved against the Java 25 variants (Apple M4 Pro, linux/arm64):

- **Startup** (prod profile, 7 runs): Java 21 + CDS 3.19 s; Java 25 with the same CDS archive 3.23 s; Java 25 + AOT cache **2.67 s (−16%)**; with compact object headers 2.62 s.
- **Throughput** (nginx → backend, `hey -c 50`, 3 rounds): `/catalog` 17,429 → 17,788 req/s, `/barbers` 21,420 → 21,128 req/s. Within-image spread reaches 18.1%; no clear regression was observed on these two cached endpoints on arm64, but this is not evidence of equivalence. Memory was measured with `docker stats`, not process RSS. Mean accumulated G1 pause time on `/barbers` rises approximately 738 → 960 ms (+30%), including startup and warm-up.
- **Correctness:** `./gradlew check` on the Java 25 toolchain passes (587 tests, coverage, SpotBugs, container-config guards). AOT adapter-cache warnings remain (see below).

## Decision

1. **Compile and run on Java 25.** `build.gradle` toolchain 25, every backend `setup-java` on 25, Renovate keeps `eclipse-temurin` on `/^25-/`.
2. **Base image `eclipse-temurin:25-jre-resolute`** (digest-pinned). Keep the latest available official image (currently 25.0.4.1), as requested, rather than block solely on waiting for 25.0.5. The [image security assessment](../deployment/java25-image-security.md) records full scans of the refreshed arm64/amd64 production images and the known JRE findings outside Trivy's coverage. Production risk approval remains required; scan success is not proof of a vulnerability-free runtime. Track the patched image and rebuild/rescan when available; APT cannot update the Temurin JRE. The current base ships no curl, wget or gnupg, so `wget` for the `local` HEALTHCHECK is installed next to tini in the shared `runtime` stage; the `prod` target still purges it.
3. **AOT cache instead of the dynamic CDS archive.** The `cds-training` stage runs the unchanged training (full app, offline, `env -i`, `spring.context.exit=onRefresh`) with `-XX:+UseG1GC -XX:AOTCacheOutput=/tmp/application.aot`; the `CMD` loads it with `-XX:AOTCache=application.aot` (default `AOTMode=auto`); both targets boot the app with `-XX:AOTMode=on` at build time so an unusable cache fails the build.
4. **No compact object headers for now.** The flag changes the object layout, so the cache must be trained with it and the image `CMD` must carry it; set only in a deployment's `JAVA_TOOL_OPTIONS`, it silently disables the cache. §62 found no clear throughput or container-memory benefit; process RSS was not measured.
5. **The Android Detox build stays on JDK 21** (JDK 25 fails React Native's CMake configuration); `android-e2e` installs both and runs the backend JAR on 25 through `start-backend`'s `java-home` input.

## Consequences

### Positive
- 16% faster cold start with the same training and the same validation discipline as ADR-017.
- Virtual threads no longer pin their carrier inside `synchronized` (JEP 491, JDK 24), which matters because `spring.threads.virtual.enabled=true` and the JDBC driver, Hibernate and Lettuce synchronise internally.
- A smaller base (106 vs 140 packages) and an LTS line supported for longer.

### Negative
- The cache is larger than the CDS archive (179 vs 149 MB uncompressed; image content +3%), and it is re-pushed with every commit like the archive was.
- A few `Failed to link AdapterHandlerEntry … AOT code cache` warnings at startup. Different training/runtime flags are a hypothesis, not a proven cause. Investigate on the updated JRE with controlled comparisons; do not attribute the warnings to deployment sizing without evidence.
- **The throughput result is from arm64.** §58's regression was measured on amd64, which is the production architecture. A native amd64 comparison, including the authenticated path from §58, is a **pre-production gate**; see BENCHMARKS.md §62 for the full checklist.
- **Rollback requires the complete previous application image.** Preserve its immutable Java 21 image digest before promotion. Restore that digest if production regresses, not merely the base image: Java 21 cannot load the new Java 25 bytecode or run the new AOT flags. This upgrade adds no database migration.
- **JRE scan coverage is incomplete.** Trivy reports 0 HIGH/CRITICAL findings in the production package inventory, but the October OpenJDK advisory lists 25.0.4.1 as affected (including security/TLS issues potentially relevant here). No suppressions or automatic production risk acceptance were added; see the linked assessment.

## Verification

- BENCHMARKS.md §62 (startup and throughput tables, package counts, image sizes).
- `ContainerImageBenchmarkTest.java25_aot_cache_replaces_cds_archive` and the tightened wget assertion in `prod_image_drops_unused_network_tools_and_setuid_bits`.
- PostgreSQL 38/38, Docker Playwright 16/16, local Detox iOS and Android 9/9 each (existing release binaries against a standalone Java 25.0.5 backend). Refreshed production targets built/scanned for arm64 and amd64; emulated amd64 construction is not a native performance result. No GitHub workflows or image publication were triggered.
