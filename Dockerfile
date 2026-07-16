# =========================================================================================
# STAGE 1: LAYER EXTRACTION
# =========================================================================================
FROM eclipse-temurin:21-jre-alpine AS builder

WORKDIR /app

# Copy the pre-built jar from the build context.
#
# NOTE on Build Performance:
# This project separates compilation (CI runner) from packaging (Docker build).
# If you ever decide to move the entire Gradle compilation inside this Dockerfile
# (a "monolithic" multi-stage build), ensure you leverage BuildKit cache mounts
# to cache the downloaded dependencies and compiler plugins:
#
#   RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar
#
# This prevents Gradle from re-downloading libraries on every build iteration.
#
# WARNING: The glob below must match exactly ONE jar. If both the bootJar and
# the -plain.jar variant are present (e.g. after `./gradlew build` instead of
# `./gradlew bootJar`), this COPY command will fail. Only the bootJar should
# be in build/libs/ before building this image.
COPY build/libs/*.jar /app/app.jar

# Extract layers using the Spring Boot jar tools mode
RUN java -Djarmode=tools -jar /app/app.jar extract --layers --launcher --destination extracted

# =========================================================================================
# STAGE 2: PRODUCTION RUNTIME STAGE
# A minimal Alpine-based JRE keeps the runtime image small while reducing the installed
# operating system surface area.
# =========================================================================================
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Install tini as PID 1 for proper signal handling and zombie reaping.
# Create a fixed non-root user (UID/GID 10001) for compatibility with
# Kubernetes Pod Security Standards.
#
# NOTE: `apk upgrade` is intentionally omitted — the base image
# (eclipse-temurin:21-jre-alpine) is already kept up to date by the image
# maintainer, and running upgrade inside the Dockerfile would make builds
# non-reproducible by pulling unpredictable package versions.
RUN apk update && apk upgrade --no-cache \
    && addgroup -g 10001 -S appgroup \
    && adduser -u 10001 -S appuser -G appgroup \
    && apk add --no-cache tini

# Copy Spring Boot's extracted layers from least frequently changed to most frequently
# changed to maximize Docker cache reuse.
COPY --link --from=builder --chown=10001:10001 /app/extracted/dependencies/ ./
COPY --link --from=builder --chown=10001:10001 /app/extracted/spring-boot-loader/ ./
COPY --link --from=builder --chown=10001:10001 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=builder --chown=10001:10001 /app/extracted/application/ ./

# Build a JVM Class Data Sharing (CDS) archive.
#
# Uses PropertiesLauncher with -Dloader.main to delegate to
# CdsTrainingApplication (com.example.cdstraining), which sits outside the
# production component-scan hierarchy and excludes infrastructure that
# requires external services (database, Redis, etc.), so this runs
# successfully during docker build before any containers are started.
#
# PropertiesLauncher is used instead of JarLauncher because it supports
# the loader.main property for specifying an alternative main class.
#
# Disable components that are irrelevant during CDS training to keep the
# startup minimal and fast:
#   - spring.aot.enabled=false              : Skip AOT-optimized path (training uses
#                                             a different class-loading profile)
#   - spring.cache.type=none                 : Don't attempt Redis connection
#   - management.otlp.tracing.export.enabled=false : Don't attempt OTLP export
#   - app.cds-training=true                  : Skips the admin-user CommandLineRunner
#
# spring.context.exit=onRefresh terminates the application immediately after
# the Spring context has fully initialized, allowing CDS to observe a complete
# startup without leaving a server running during the Docker build.
RUN OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4317 java -XX:ArchiveClassesAtExit=application.jsa \
         -Dspring.aot.enabled=false \
         -Dloader.main=com.example.cdstraining.CdsTrainingApplication \
         -Dspring.context.exit=onRefresh \
         -Dapp.cds-training=true \
         -Dspring.flyway.enabled=false \
         -Dspring.cache.type=none \
         -Dmanagement.tracing.enabled=false \
         -Dmanagement.otlp.tracing.export.enabled=false \
         -Dotel.sdk.disabled=true \
         -Dotel.exporter.otlp.endpoint=http://localhost:4317 \
         -Dotel.exporter.otlp.traces.endpoint=http://localhost:4317 \
         org.springframework.boot.loader.launch.PropertiesLauncher \
    && test -s application.jsa \
    && chown 10001:10001 application.jsa

# Drop root privileges.
USER 10001:10001

EXPOSE 8080

# =========================================================================================
# JVM TUNING (Container-Portable Heap Sizing)
#
# -Dspring.aot.enabled=true  : Enables Spring Boot's Ahead-of-Time generated classes,
#                              reducing startup overhead by avoiding runtime reflection.
#
# -XX:InitialRAMPercentage=50.0
# -XX:MaxRAMPercentage=75.0
#
#   These replace the old fixed -Xms1g / -Xmx1g so the same image adapts to any
#   container memory limit (2 GB, 4 GB, 16 GB, ...) without a rebuild.
#   75% leaves headroom for metaspace, thread stacks, direct memory, and other
#   native JVM overhead so the container's RSS stays below its cgroup limit.
#
# -XX:MaxDirectMemorySize    : Caps Netty's off-heap direct buffers (Lettuce Redis
#                              client + OpenTelemetry). Without this the JVM default
#                              lets direct memory track the heap size and the
#                              container RSS blows past -Xmx and hits the cgroup
#                              limit.
#
# -XX:MaxMetaspaceSize       : Caps class-metadata memory so a long-running
#                              container cannot slowly creep upward.
#
# -XX:+ExitOnOutOfMemoryError: Terminates immediately on OOM so failures are
#                              explicit instead of leaving the JVM in an unstable
#                              state.
#
# Garbage Collector
#
# No collector is explicitly selected — JDK 21 defaults to G1GC.
#
# G1 targets predictable pause times (approximately 200 ms by default via
# MaxGCPauseMillis) rather than maximizing raw throughput, making it a sensible
# default for request/response services where latency generally matters more
# than peak requests per second.
#
# ParallelGC was previously used here because local benchmarking on Apple M4 Pro
# showed higher throughput numbers. However, inside Kubernetes containers the
# workload is server-style (mixed young/old GC, variable request rates) where
# G1's adaptive heuristics and pause-time control serve the application better.
# The throughput advantage of ParallelGC on a 14-core laptop does not translate
# to a contended container CPU-share in production.
#
# Deliberately NOT configured
# ---------------------------
#
# -XX:+AlwaysPreTouch
#
#   Pretouching commits the entire initial heap during startup, which means every
#   pod restart pays a measurable latency cost before serving traffic. In Kubernetes
#   where pods are recycled regularly (rollouts, scaling events, node drains), fast
#   startup matters more than shaving a few microseconds off the first request's
#   page faults. Spring AOT and CDS already handle the bulk of startup optimisation.
# =========================================================================================
ENTRYPOINT ["/sbin/tini", "--", "java"]

# Replace the shell with direct JVM execution.
CMD [ \
    "-Dspring.aot.enabled=true", \
    "-XX:InitialRAMPercentage=50.0", \
    "-XX:MaxRAMPercentage=75.0", \
    "-XX:MaxDirectMemorySize=256m", \
    "-XX:MaxMetaspaceSize=256m", \
    "-XX:+ExitOnOutOfMemoryError", \
    "-XX:SharedArchiveFile=application.jsa", \
    "-Xshare:auto", \
    "org.springframework.boot.loader.launch.JarLauncher" \
]