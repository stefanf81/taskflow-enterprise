# =========================================================================================
# STAGE 1: BUILD STAGE
# We use the standard JDK (Java Development Kit) because Gradle and javac are required
# to compile the application. This stage is discarded after the build, so none of the
# build tools are included in the final runtime image.
# =========================================================================================
FROM eclipse-temurin:21-jdk AS builder

WORKDIR /app

# [CACHE OPTIMIZATION]
# Copy the Gradle wrapper and build configuration first so dependency resolution is
# cached independently of application source changes.
COPY gradle/ /app/gradle/
COPY gradlew build.gradle settings.gradle gradle.properties /app/

# [DEPENDENCY PRE-DOWNLOAD]
# Persist Gradle's dependency cache between local builds using a BuildKit cache mount.
# Only changes to the build configuration will invalidate this layer.
RUN --mount=type=cache,target=/root/.gradle \
    chmod +x gradlew && \
    ./gradlew dependencies --no-daemon

# Copy the application source.
COPY src/ /app/src/

# [BUILD & LAYER EXTRACTION]
# Reuse the Gradle cache, perform Spring Boot AOT compilation, build the executable JAR,
# then extract it into layered form to maximize Docker layer reuse.
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew processAot bootJar --no-daemon && \
    java -Djarmode=tools \
         -jar build/libs/*.jar \
         extract \
         --layers \
         --launcher \
         --destination extracted

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
COPY --from=builder --chown=10001:10001 /app/extracted/dependencies/ ./
COPY --from=builder --chown=10001:10001 /app/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=10001:10001 /app/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=10001:10001 /app/extracted/application/ ./

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
-XX:+ExitOnOutOfMemoryError"

ENTRYPOINT ["/sbin/tini", "--"]

# Replace the shell with the JVM so signals from tini are delivered directly.
CMD ["sh", "-c", "exec java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]