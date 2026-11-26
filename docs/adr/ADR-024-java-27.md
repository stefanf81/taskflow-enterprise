# ADR-024: Java 27 Toolchain and Runtime

**Status:** Proposed (branch `claude/java27-full`; the lower-risk alternative, Java 25 bytecode on a Java 27 runtime, is on `claude/java27-runtime-only`). Production approval is operator-controlled, as for ADR-020.

## Context

ADR-020 moved the backend to Java 25 LTS with an AOT cache. JDK 26 (March 2026) and JDK 27 (September 2026) have since shipped. The weekly `jdk-next` workflow ran the full test and Testcontainers suites on JDK 27 and trained and booted the AOT cache on `eclipse-temurin:27-jre-resolute` without failures (run 45498419557, 2026-11-24).

What 26 and 27 change for this service, without any code change:

- **G1:** less synchronization between application and GC threads (JEP 522, JDK 26).
- **Compact object headers on by default (JEP 534, JDK 27).** ADR-020 decision 6 already accepts the JVM default, so training and runtime agree.
- **G1 becomes the default everywhere (JEP 523):** no effect here.
- **Post-quantum hybrid key exchange first in the TLS 1.3 named groups (JEP 527).**
- **AOT cache with any GC (JEP 516).**
- **JFR redaction by default (JEP 536).**
- **Virtual threads waiting on a class initializer unmount instead of pinning (JDK 26).**
- **Removed launcher flags**, JVMCI, `Thread.stop` and the `VFORK` launch mechanism. None is used here or in the GitOps `JAVA_TOOL_OPTIONS`.

Every new language and library API in 26/27 is still a preview or incubator: structured concurrency, lazy constants, primitive patterns, the PEM API and the Vector API.

Tooling already supports Java 27 class files (version 71):

| Tool | Version here | Java 27 support |
| :--- | :--- | :--- |
| Gradle | 9.9.2 | Since 9.8 |
| Spring Boot | 4.2.0 | Lists 27 |
| JaCoCo | 0.8.16 | Official support |
| SpotBugs | 4.10.5 | BCEL with `MAJOR_27` |
| ArchUnit | 1.5.1 | ASM 9.10.1, not officially tested on 27 |
| Byte Buddy | 1.18.17 | `JAVA_V27` |
| palantir-java-format | | No stated support; runs fine on the JDK 27 javac |

Java 27 is **not** an LTS. Its updates end when JDK 28 ships (2027-03-09), and 28 is currently blocked for this application (ADR-020 decision 7). The next LTS is 29 (September 2027).

## Decision

1. **Compile for and run on Java 27.**
   - `build.gradle` toolchain 27 (class file version 71).
   - `JAVA_IMAGE` is `eclipse-temurin:27-jre-resolute`, digest-pinned (Temurin 27.0.1.1+4 at the 2026-11-26 check).
   - Every backend `setup-java` is on 27: `ci`, `dast`, `security`, `pushdockerimage`, `dependency-health-audit`, the mobile E2E backend and `jdk-next`'s compiler.
   - Renovate holds `eclipse-temurin` on `/^27-/`.
2. **No preview features**, for the same reasons as on Java 25: they would need `--enable-preview` everywhere, including the AOT training and the image `CMD`.
3. **`jdk-next` keeps JDK 28 EA only**, plus AOT training on the floating 27 tag.
4. **Exit plan by 2027-03-09 (JDK 28 GA): move to 28.** That needs a Spring release whose repackaged Objenesis no longer calls the two-argument `newConstructorForSerialization` (ADR-020 decision 7). The alternative is giving every class-proxied bean a non-private no-arg constructor. Going back to 25 is not a base-image change any more (see below).

## Consequences

### Positive
- The JIT, GC and object-layout improvements of 26/27, and one JDK everywhere (compiler, tests, image).
- The code may use Java 26/27 final APIs and language changes as they appear; there are none of note in 26/27 for this codebase.

### Negative
- **Rollback needs the complete previous application image digest.** Java 25 cannot load class file version 71, so swapping `JAVA_IMAGE` back to 25 alone fails at startup. Preserve the last Java 25 image digest before promotion.
- **A non-LTS line with roughly three and a half months of updates left, and no way back to 25 without a rebuild.** Option A (`claude/java27-runtime-only`) keeps that way back.
- The JEP 500 "final field mutated reflectively" warning (Spring's `ReflectionUtils` on `SecurityContextHolderFilter`, from spring-security-test) prints in test JVMs on 27.

## Verification

See BENCHMARKS.md §86:
- Startup and throughput interleaved against the Java 25 image on native amd64.
- `./gradlew check`: 875 tests, 0 failures, on 27.0.1.1. Class file version 71; SpotBugs and Spotless run on the JDK 27 Gradle JVM.
- `testcontainersTest` 50/50.
- Container guards 27/27.
- The AOT cache trains and passes the `-XX:AOTMode=on` boot validation.
