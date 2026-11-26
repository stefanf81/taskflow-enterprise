# ADR-024: Java 27 Runtime for Java 25 Bytecode

**Status:** Not adopted (2026-11-26). The design below is ready on branch `claude/java27-runtime-only`, but Java 27 cost 9–18% throughput on amd64 (BENCHMARKS.md §86); production stays on Java 25 LTS (ADR-020). The alternative, Java 27 bytecode, is on `claude/java27-full` and measured the same. Production approval is operator-controlled, as for ADR-020.

## Context

ADR-020 moved the backend to Java 25 LTS with an AOT cache. JDK 26 (March 2026) and JDK 27 (September 2026) have since shipped. The weekly `jdk-next` workflow ran the full test and Testcontainers suites on JDK 27 and trained and booted the AOT cache on `eclipse-temurin:27-jre-resolute` without failures (run 45498419557, 2026-11-24).

What 26 and 27 change for this service, without any code change:

- **G1:** less synchronization between application and GC threads (JEP 522, JDK 26).
- **Compact object headers on by default (JEP 534, JDK 27):** 64-bit instead of 96-bit headers. ADR-020 decision 6 already accepts the JVM default, so training and runtime agree.
- **G1 becomes the default everywhere (JEP 523):** no effect here; every JVM sets `-XX:+UseG1GC`.
- **Post-quantum hybrid key exchange first in the TLS 1.3 named groups (JEP 527):** affects outbound TLS (SMTP, OTLP, any Redis or PostgreSQL TLS).
- **AOT cache with any GC (JEP 516).**
- **JFR redaction of sensitive arguments, environment variables and properties by default (JEP 536).**
- **Virtual threads waiting on a class initializer unmount instead of pinning (JDK 26).**
- **Removed launcher flags** (`-noverify`, `-Xverify:none`, `-noclassgc`, `-verifyremote`), JVMCI, `Thread.stop` and the `VFORK` launch mechanism. None is used here or in the GitOps `JAVA_TOOL_OPTIONS`.

Every new language and library API in 26/27 is still a preview or incubator: structured concurrency, lazy constants, primitive patterns, the PEM API and the Vector API. Using one means `--enable-preview` in the compiler, the tests, the AOT training and the image `CMD`, and class files that run only on that exact major.

Java 27 is **not** an LTS. Its updates end when JDK 28 ships (2027-03-09), and 28 is currently blocked for this application (ADR-020 decision 7: Spring's repackaged Objenesis cannot instantiate CGLIB proxies on 28). The next LTS is 29 (September 2027).

## Decision (as proposed)

1. **Run on Java 27, keep compiling for Java 25.** The Dockerfile's `JAVA_IMAGE` is `eclipse-temurin:27-jre-resolute` (digest-pinned; Temurin 27.0.1.1+4 at the 2026-11-26 check). `build.gradle` keeps the Java 25 toolchain, so the JAR stays class file version 69.
2. **Test on the runtime that ships.** Every `Test` task runs on Java 27 (`runtimeJavaVersion` in `build.gradle`; `-PtestJavaVersion` still overrides it for `jdk-next`). CI's `backend` and `backend-integration` jobs install 27 next to 25 (`RUNTIME_JAVA_VERSION`). Gradle finds 27 through `org.gradle.java.installations.fromEnv`, and otherwise provisions it with foojay. Every job that boots the JAR uses 27: contract, E2E, DAST and the Detox backend.
3. **No preview features.** They would tie the class files to 27 and undo the rollback below.
4. **Renovate holds `eclipse-temurin` on `/^27-/`.** `jdk-next` drops its JDK 27 test leg, which the blocking jobs now cover, keeps JDK 28 EA, and keeps training the AOT cache on the floating 27 tag ahead of Renovate's digest.
5. **Exit plan by 2027-03-09 (JDK 28 GA).** Either move to 28, once a Spring release ships an Objenesis without the two-argument `newConstructorForSerialization` call (ADR-020 decision 7), or go back to the Java 25 base. Do not stay on 27 after its last update.

## Measurement (BENCHMARKS.md §86, 2026-11-26)

Native amd64, interleaved, the backend on two pinned cores:

| | Java 25 | A: 27 runtime | B: 27 toolchain + runtime |
| :--- | ---: | ---: | ---: |
| Startup, prod profile, median of 7 | 6.68 s | 6.28 s (−6%) | 6.32 s (−5%) |
| `/catalog` req/s, mean of 5 rounds | 4,115 | 3,352 (−18.5%) | 3,447 (−16.2%) |
| `/barbers` req/s | 4,413 | 3,618 (−18.0%) | 3,664 (−17.0%) |
| `/auth/me` req/s | 4,404 | 3,948 (−10.4%) | 4,012 (−8.9%) |
| Process RSS after load | 601 MiB | 1,292 MiB | 1,225 MiB |

On `/catalog` and `/barbers`, every Java 25 round beats every Java 27 round. These do not explain the gap:
- Compact headers off.
- The pre-27 G1 heap free ratios.
- Java 25 keeping its whole heap the way 27 does.

ZGC with the AOT cache (now possible, JEP 516) and JFR from boot are slower still.

## Consequences

### Positive
- The GC and object-layout changes of 26/27 ship without a bytecode change (they halve GC pause time; §86 still measured a net throughput loss).
- **Rollback is a base-image change.** Restore the Java 25 `JAVA_IMAGE` digest and Renovate rule and rebuild: the same JAR, the same Dockerfile flags, and the AOT cache retrained on 25. Restoring the previous application image digest also works.
- Tests, contract, E2E and DAST exercise the JVM that runs in production.

### Negative
- A non-LTS runtime with roughly three and a half months of updates left. The exit plan (decision 5) is mandatory.
- CI installs two JDKs in the test jobs, and local `./gradlew test` needs a JDK 27 (foojay downloads one).
- The JEP 500 "final field mutated reflectively" warning (Spring's `ReflectionUtils` on `SecurityContextHolderFilter`, from spring-security-test) prints in test JVMs on 27. It is a warning, not an error, on 27.

## Verification

See BENCHMARKS.md §86 (startup, throughput, memory, GC, the JDK 26/27 settings and the strict-integrity test run) and the measurement above; `./gradlew check` (875 tests, 0 failures, tests on 27.0.1.1); `testcontainersTest` 50/50; container guards 27/27; the AOT cache trains and passes the `-XX:AOTMode=on` boot validation on the 27 base.
