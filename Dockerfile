# syntax=docker/dockerfile:1

# Local development Spring Boot image for Apple Silicon (linux/arm64).
# Uses the multi-platform index digest matching the production base JVM.
ARG JAVA_IMAGE=eclipse-temurin:21-jre-alpine@sha256:974b08960c5d96694c780e65b2d5705268ab1e1ca1a0dd0caf4ba6c3fe34d699
ARG PLATFORM=linux/arm64

# JAR extraction is architecture-independent: runs natively on Apple Silicon.
# Pre-built bootJar is supplied from host build context (via ./gradlew bootJar).
FROM --platform=$BUILDPLATFORM ${JAVA_IMAGE} AS extractor
WORKDIR /app

# build.gradle disables the plain jar; this matches exactly one bootJar.
COPY build/libs/*.jar application.jar

# Extract application into standard Spring Boot CDS-friendly layout
# (application.jar with manifest Class-Path pointing to lib/).
RUN --network=none java -Djarmode=tools -jar application.jar \
    extract --layers --destination extracted

# Target architecture base stage for arm64 runtime identity.
FROM --platform=$PLATFORM ${JAVA_IMAGE} AS java-base
WORKDIR /app
RUN addgroup -g 10001 -S appgroup \
    && adduser -u 10001 -S appuser -G appgroup

FROM java-base AS cds-training

# Copy layers preserving timestamps and paths for CDS archive validation.
COPY --link --from=extractor --chown=0:0 /app/extracted/dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/spring-boot-loader/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/application/ ./

USER 10001:10001

# Headless training run generating JVM Class Data Sharing (CDS) archive.
# -cp application.jar uses manifest Class-Path to run CdsTrainingApplication directly.
RUN --network=none java -XX:ArchiveClassesAtExit=/tmp/application.jsa \
         -Dspring.context.exit=onRefresh \
         -Dapp.cds-training=true \
         -Dspring.flyway.enabled=false \
         -Dspring.cache.type=redis \
         -Dotel.sdk.disabled=true \
         -cp application.jar com.example.cdstraining.CdsTrainingApplication \
    && test -s /tmp/application.jsa

FROM java-base AS runtime

# Local development: `apk upgrade` is intentionally omitted so local rebuilds
# stay deterministic and fast without pulling unpredictable Alpine packages.
RUN apk add --no-cache tini

# Copy application layers and the trained CDS archive.
COPY --link --from=extractor --chown=0:0 /app/extracted/dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/spring-boot-loader/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/application/ ./
COPY --link --from=cds-training --chown=0:0 --chmod=0444 /tmp/application.jsa ./application.jsa

USER 10001:10001

# Validate the archive at build time under the final arm64 environment.
RUN --network=none --mount=type=tmpfs,target=/tmp \
    java -Xshare:on -XX:SharedArchiveFile=application.jsa \
         -Xlog:cds=info -cp application.jar -version

# Health check for standalone docker run and compose service_healthy dependency.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s CMD wget -qO /dev/null http://localhost:8080/actuator/health/liveness || exit 1

EXPOSE 8080

# Sizing and GC tuning are owned by deployment (docker-compose.yml JAVA_TOOL_OPTIONS).
# CMD carries only environment-invariant flags.
ENTRYPOINT ["/sbin/tini", "--", "java"]
CMD [ \
    "-XX:+ExitOnOutOfMemoryError", \
    "-XX:SharedArchiveFile=application.jsa", \
    "-Xshare:auto", \
    "-jar", \
    "application.jar" \
]
