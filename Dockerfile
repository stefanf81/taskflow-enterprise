# =========================================================================================
# STAGE 1: LAYER EXTRACTION
#
# linux/arm64 is pinned explicitly so this image always matches the local Apple
# Silicon runtime. The extractor only runs `java -Djarmode=tools ...`, which is a
# pure JRE operation — no JDK is needed.
# =========================================================================================
FROM --platform=linux/arm64 eclipse-temurin:21-jre-alpine AS extractor

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
FROM --platform=linux/arm64 eclipse-temurin:21-jre-alpine

WORKDIR /app

# Install tini as PID 1 for proper signal handling and zombie reaping.
# Create a fixed non-root user (UID/GID 10001) for compatibility with
# Kubernetes Pod Security Standards.
#
# NOTE: `apk upgrade` is intentionally omitted — the base image
# (eclipse-temurin:21-jre-alpine) is already kept up to date by the image
# maintainer, and running upgrade inside the Dockerfile would make builds
# non-reproducible by pulling unpredictable package versions.
#
# Intentionally divergent from Dockerfile.x64 (which runs `apk upgrade` for
# prod security patching) so local builds stay reproducible across rebuilds.
RUN apk update --no-cache \
    && addgroup -g 10001 -S appgroup \
    && adduser -u 10001 -S appuser -G appgroup \
    && apk add --no-cache tini

# Copy Spring Boot's extracted layers from least frequently changed to most frequently
# changed to maximize Docker cache reuse.
COPY --link --from=extractor --chown=10001:10001 /app/extracted/dependencies/ ./
COPY --link --from=extractor --chown=10001:10001 /app/extracted/spring-boot-loader/ ./
COPY --link --from=extractor --chown=10001:10001 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=extractor --chown=10001:10001 /app/extracted/application/ ./

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
#   - spring.cache.type=none                 : Don't attempt Redis connection
#   - management.otlp.tracing.export.enabled=false : Don't attempt OTLP export
#   - app.cds-training=true                  : Skips the admin-user CommandLineRunner
#
# spring.context.exit=onRefresh terminates the application immediately after
# the Spring context has fully initialized, allowing CDS to observe a complete
# startup without leaving a server running during the Docker build.
RUN java -XX:ArchiveClassesAtExit=application.jsa \
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
# JVM TUNING — image- vs deployment-owned flags
#
# JVM sizing (heap, off-heap caps) is owned by the DEPLOYMENT via JAVA_TOOL_OPTIONS,
# not the image. The image CMD carries only flags that must hold in every environment:
#
#   -XX:SharedArchiveFile=application.jsa: CDS archive generated at build time.
#   -Xshare:auto                         : Use the CDS archive when compatible.
#   -XX:+ExitOnOutOfMemoryError          : Safety invariant — fail fast on OOM.
#
# Heap / direct / metaspace sizing live in:
#   - docker-compose.yml   (local dev stack)
#   - homelab/TF/gitops/.../backend.yaml JAVA_TOOL_OPTIONS (prod)
#
# Setting sizing flags here would silently win over JAVA_TOOL_OPTIONS (JVM
# "last-wins" precedence for non-sticky flags) and recreate the precedence bug
# where the deployment's tuning was a no-op. Keep this CMD sizing-agnostic.
#
# Garbage collector: no collector is selected explicitly — JDK 21 defaults to G1GC,
# the right choice for a latency-sensitive request/response service. Operators can
# override via JAVA_TOOL_OPTIONS if a different collector is ever warranted.
# =========================================================================================
ENTRYPOINT ["/sbin/tini", "--", "java"]

# Replace the shell with direct JVM execution.
CMD [ \
    "-XX:+ExitOnOutOfMemoryError", \
    "-XX:SharedArchiveFile=application.jsa", \
    "-Xshare:auto", \
    "org.springframework.boot.loader.launch.JarLauncher" \
]