# =========================================================================================
# STAGE 1: LAYER EXTRACTION
# =========================================================================================
FROM eclipse-temurin:21-jdk AS builder

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
COPY build/libs/*.jar /app/app.jar

# Extract layers using the Spring Boot jar tools mode
RUN --mount=type=cache,target=/tmp \
    java -Djarmode=tools -jar /app/app.jar extract --layers --launcher --destination extracted

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
RUN apk add --no-cache tini \
    && addgroup -S -g 10001 appgroup \
    && adduser -S -u 10001 -G appgroup appuser

# Copy Spring Boot's extracted layers from least frequently changed to most frequently
# changed to maximize Docker cache reuse.
COPY --link --from=builder --chown=10001:10001 /app/extracted/dependencies/ ./
COPY --link --from=builder --chown=10001:10001 /app/extracted/spring-boot-loader/ ./
COPY --link --from=builder --chown=10001:10001 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=builder --chown=10001:10001 /app/extracted/application/ ./

# Perform a Class Data Sharing (CDS) training run
RUN java -XX:ArchiveClassesAtExit=application.jsa \
         -Dspring.context.exit=onRefresh \
         -Dspring.flyway.enabled=false \
         -Dspring.jpa.hibernate.ddl-auto=none \
         org.springframework.boot.loader.launch.JarLauncher \
    && chown 10001:10001 application.jsa

# Drop root privileges.
USER 10001:10001

EXPOSE 8080

# =========================================================================================
# JVM TUNING (Apple M4 Pro / Local Throughput Benchmarking)
#
# -Dspring.aot.enabled=true  : Enables Spring Boot's Ahead-of-Time generated classes,
#                              reducing startup overhead by avoiding runtime reflection.
#
# -Xms1g -Xmx1g              : Fixes the heap size at 1 GB, eliminating runtime heap
#                              expansion and contraction during benchmarking.
#
# -XX:+UseParallelGC         : Uses the throughput-oriented Parallel Garbage Collector.
#                              Retained because benchmarking showed it performs better
#                              for this workload than the default G1 collector.
#
# -XX:+AlwaysPreTouch        : Commits and touches the entire heap during startup,
#                              trading slower startup for more predictable steady-state
#                              memory access and fewer first-touch page faults.
#
# -XX:+ExitOnOutOfMemoryError: Terminates immediately on OOM so failures are explicit
#                              instead of leaving the JVM in an unstable state.
# =========================================================================================
ENV JAVA_OPTS="-Dspring.aot.enabled=true \
-Xms1g \
-Xmx1g \
-XX:+UseParallelGC \
-XX:+AlwaysPreTouch \
-XX:+ExitOnOutOfMemoryError \
-XX:SharedArchiveFile=application.jsa \
-Xshare:on"

ENTRYPOINT ["/sbin/tini", "--"]

# Replace the shell with the JVM so signals from tini are delivered directly.
CMD ["sh", "-c", "exec java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]