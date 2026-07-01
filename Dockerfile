# =========================================================================================
# STAGE 1: BUILD STAGE
# We use the standard JDK (Java Development Kit) here because we need the 'javac' compiler 
# and Gradle to build the application. This stage is discarded after the build finishes, 
# ensuring none of the build tools bloat our final production image.
# =========================================================================================
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app

# [CACHE OPTIMIZATION] Copy gradle wrapper and build files first.
# Docker caches layers sequentially. By copying these before the source code,
# we ensure that if we only change Java code, Docker doesn't invalidate the dependency cache.
COPY gradle/ /app/gradle/
COPY gradlew build.gradle settings.gradle /app/
COPY src/ /app/src/

# [BUILDKIT CACHE MOUNT] This is an elite Docker optimization.
# It mounts a persistent volume to /root/.gradle that survives between independent Docker builds.
# If a build fails or you add a new library, Gradle won't have to re-download the entire internet again.
# We run 'processAot' to trigger Spring Boot's Ahead-Of-Time compilation (removing runtime reflection overhead).
RUN --mount=type=cache,target=/root/.gradle \
    chmod +x gradlew && ./gradlew processAot bootJar --no-daemon

# [LAYERED JAR EXTRACTION] Instead of running a massive 50MB "Fat JAR", we extract it into 4 layers.
# This ensures that when you push a code change to Kubernetes, Docker only uploads the tiny 'application' layer (~4MB)
# instead of pushing the heavy 3rd-party dependencies every single time.
RUN java -Djarmode=tools -jar build/libs/*.jar extract --layers --launcher --destination extracted

# =========================================================================================
# STAGE 2: PRODUCTION RUNTIME STAGE
# We switch to Alpine Linux JRE (Java Runtime Environment). 
# Alpine uses 'musl' libc, stripping out vulnerable OS utilities and reducing the image size by ~20%.
# =========================================================================================
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# [PROCESS REAPING & KUBERNETES PSS] 
# 1. Install 'tini': A tiny init-system that runs as PID 1 to gracefully handle Kubernetes SIGTERM signals and reap zombie processes.
# 2. Strict UIDs: We hardcode numeric user/group IDs (10001) to satisfy Kubernetes strict Pod Security Standards (PSS).
RUN apk add --no-cache tini \
    && addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup

# [CACHED LAYER COPY] Copy the extracted layers from the builder stage.
# Order is critical here: least-frequently changed (dependencies) to most-frequently changed (application).
COPY --from=builder --chown=10001:10001 /app/extracted/dependencies/ ./
COPY --from=builder --chown=10001:10001 /app/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=10001:10001 /app/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=10001:10001 /app/extracted/application/ ./

# Drop root privileges immediately for security compliance.
USER 10001:10001

EXPOSE 8080

# [JVM TUNING: M4 PRO / HIGH THROUGHPUT]
# -Dspring.aot.enabled=true  : Uses the AOT generated classes to bypass slow reflection.
# -Xms1g -Xmx1g              : Locks heap size to 1GB to prevent OS dynamic memory allocation pauses.
# -XX:+UseParallelGC         : Optimizes for pure maximum Request-Per-Second (RPS) throughput.
# -XX:ParallelGCThreads=10   : Hardware pins the GC specifically to the 10 Performance Cores (P-cores) of the M4 Pro.
# -XX:-UseAdaptiveSizePolicy : Prevents the JVM from constantly resizing young/old generations under load.
# -XX:+UseSIMDForMemoryOps   : Forces AArch64 vectorized instructions to exploit M4 Pro memory bandwidth.
ENV JAVA_OPTS="-Dspring.aot.enabled=true -Xms1g -Xmx1g -XX:+UseParallelGC -XX:ParallelGCThreads=10 -XX:+AlwaysPreTouch -XX:-UseAdaptiveSizePolicy -XX:+UseSIMDForMemoryOps"

# [ENTRYPOINT] Tini takes PID 1, and spawns the Spring Boot JarLauncher to run our exploded layers directly.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
