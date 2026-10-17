# syntax=docker/dockerfile:1

# Spring Boot / Java 21 backend image. One Dockerfile, two final targets:
#
#   prod   (--target prod)   production image: Ubuntu package refresh on every
#                            build, download tools purged, setuid bits stripped,
#                            no HEALTHCHECK (Kubernetes probes own it).
#   local  (--target local)  docker-compose image: wget kept for the
#                            HEALTHCHECK, no apt-get upgrade so local rebuilds
#                            stay cache-friendly and fast. Last stage, so it is
#                            also the default target: an untargeted
#                            `docker build .` yields an image the compose
#                            healthcheck (wget) works with.
#
# Everything above the two targets (JAR extraction, CDS training, tini, the
# runtime layers and the launch command) is shared, so the variants cannot
# drift apart.
#
# The target architecture comes from the builder, not from this file: compose
# builds for the host (`docker compose build`), the workflows pass
# `platforms: linux/amd64` for the production image, and `docker build
# --platform` overrides either. A platform hardcoded here made Linux/amd64 hosts
# build the arm64 local image under emulation (or fail without binfmt). Only
# the extractor stage pins $BUILDPLATFORM, because JAR extraction is
# architecture-independent and should run natively.
#
# Explicit -resolute (Ubuntu 26.04 LTS, glibc) because the floating 21-jre tag
# tracks the current Ubuntu release and would drift silently. Renovate updates
# the digest while the project's Java 21 policy keeps the major.
ARG JAVA_IMAGE=eclipse-temurin:21-jre-resolute@sha256:e9a838377dc3719c0a0e7d1ac2e13d6f49c5cacd643f9a22024845736bb00ad9

# JAR extraction is architecture-independent: run it natively on the build host
# (Apple Silicon as well as amd64 CI). Compilation is performed by Gradle before
# the Docker build; the pre-built bootJar is supplied from the build context.
FROM --platform=$BUILDPLATFORM ${JAVA_IMAGE} AS extractor
WORKDIR /app

# build.gradle disables the plain jar; this must match exactly one bootJar.
COPY build/libs/*.jar application.jar

# The default layout creates a small application.jar with a manifest Class-Path
# pointing to lib/. Standard JVM class loading makes this layout CDS-friendly.
RUN --network=none java -Djarmode=tools -jar application.jar \
    extract --layers --destination extracted

# CDS is architecture/JVM-specific. Training and runtime share the exact target
# JRE and identity; package refreshes are confined to the prod target so they do
# not retrain CDS.
# No --system for useradd: a --system account expects UID < 1000 and emits a
# warning for the explicit 10001; without it shadow still locks the password.
FROM ${JAVA_IMAGE} AS java-base
WORKDIR /app
RUN groupadd --system --gid 10001 appgroup \
    && useradd --uid 10001 --gid 10001 --no-create-home \
         --home-dir /nonexistent --shell /usr/sbin/nologin appuser

FROM java-base AS cds-training

# Match runtime paths, contents, and JAR timestamps for CDS classpath validation.
COPY --link --from=extractor --chown=0:0 /app/extracted/dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/spring-boot-loader/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/application/ ./

USER 10001:10001

# Train on the real application in its default profile (in-memory H2) so
# Hibernate, Spring Data, Flyway, and the web/security graph are archived; a
# trimmed context missed ~30% of prod startup classes (BENCHMARKS.md §56).
# It halts at refresh, before runners, schedulers, or binding the port, and
# network isolation keeps that startup infrastructure-free. cache.type=redis
# builds the production cache manager without connecting. env -i drops
# build-injected variables such as BuildKit's OTEL_* tracing-socket endpoint,
# which Spring Boot's OTLP exporters reject. Only the archive is published.
RUN --network=none env -i PATH="$PATH" LANG="$LANG" LC_ALL="$LC_ALL" \
         java -XX:ArchiveClassesAtExit=/tmp/application.jsa \
         -Dspring.context.exit=onRefresh \
         -Dspring.cache.type=redis \
         -Dotel.sdk.disabled=true \
         -jar application.jar \
    && test -s /tmp/application.jsa

# Shared runtime: tini, application layers, the trained archive and the launch
# command. A complete, runnable image; the targets below add only the prod
# package refresh, the runtime user, the archive validation under that final
# identity and (local) the HEALTHCHECK.
FROM java-base AS runtime

# tini (/usr/bin/tini on the Ubuntu-based Temurin image) is the ENTRYPOINT
# below, so it is installed here, before the application layers: a new JAR
# then reuses this cached layer instead of re-running apt (and needing network)
# on every local rebuild. No `apt-get upgrade` here; the prod target refreshes
# packages on top. tini itself is not version-pinned, so a build without this
# cached layer can resolve a newer tini from the archive.
# --error-on=any: by default a transient download failure is only a warning
# and `apt-get update` still succeeds; fail the build instead.
RUN apt-get update --error-on=any \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Stable dependencies first; root-owned application files are readable but not
# writable by the runtime user, including outside a read-only deployment.
COPY --link --from=extractor --chown=0:0 /app/extracted/dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/spring-boot-loader/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/snapshot-dependencies/ ./
COPY --link --from=extractor --chown=0:0 /app/extracted/application/ ./
COPY --link --from=cds-training --chown=0:0 --chmod=0444 /tmp/application.jsa ./application.jsa

# The Ubuntu base sets its own title and description labels, which every image
# built on it inherits; replace them with this image's identity.
LABEL org.opencontainers.image.title="TaskFlow Backend" \
      org.opencontainers.image.description="TaskFlow Spring Boot backend" \
      org.opencontainers.image.source="https://github.com/stefanf81/taskflow-enterprise"

EXPOSE 8080

# Sizing and GC tuning are owned by the deployment (docker-compose.yml and the
# Kubernetes manifest's JAVA_TOOL_OPTIONS). CMD carries only environment-
# invariant flags so image arguments cannot override that tuning. tini forwards
# shutdown signals and reaps children; exec-form CMD starts Java directly with
# the extracted application JAR, not the original executable JAR.
ENTRYPOINT ["/usr/bin/tini", "--", "java"]
CMD [ \
    "-XX:+ExitOnOutOfMemoryError", \
    "-XX:SharedArchiveFile=application.jsa", \
    "-Xshare:auto", \
    "-jar", \
    "application.jar" \
]

# -----------------------------------------------------------------------------
# prod: the production image (the workflows build it with --target prod for
# linux/amd64; build it by hand with --platform linux/amd64 --target prod).
# -----------------------------------------------------------------------------
FROM runtime AS prod

# CI changes APT_BUST on every build to obtain Ubuntu package fixes. This keeps
# the JVM base pinned, but package resolution intentionally remains build-time.
# Temurin's JRE lives in /opt/java/openjdk and is not managed by dpkg. tini
# comes from the shared runtime stage; it was installed explicitly, so the
# --auto-remove below keeps it, and the upgrade refreshes it.
# The base ships curl, wget, and gnupg (plus ~30 dependencies: krb5, LDAP,
# GnuTLS, libssh2, SQLite) for its own build; the JVM uses none of them, so
# Kubernetes probes must be httpGet rather than exec curl/wget. Purge them
# before the upgrade so they are neither refreshed nor left for an intruder,
# then drop setuid/setgid bits in case a pod is admitted with escalation.
# The base also ships Canonical's Pebble service manager at /usr/bin/pebble
# (not dpkg-managed, so apt cannot patch it) and a world-writable
# /var/lib/pebble state directory. Nothing starts either one; its static Go
# binary can only be fixed by an upstream rebuild, and Go stdlib 1.26.7 tripped
# the Trivy HIGH gate (CVE-2026-97031/78667/78669, fixed upstream in
# 1.26.9/1.27.2), so remove both.
# --error-on=any: without it, a failed index download is only a warning and the
# upgrade below can succeed without checking every repository.
ARG APT_BUST=stable
RUN : "${APT_BUST}" \
    && apt-get update --error-on=any \
    && DEBIAN_FRONTEND=noninteractive apt-get purge -y --auto-remove curl wget gnupg \
    && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/bin/pebble \
    && rm -rf /var/lib/pebble \
    && find / -xdev -type f -perm /6000 -exec chmod a-s {} +

USER 10001:10001

# Validate the archive after the package refresh, under the final identity and
# classpath, by booting the application with it exactly like the training run
# (-Xshare:on fails instead of silently falling back). A plain `java -version`
# only maps the JDK classes: an archive that crashes the real startup passed it
# (reproduced with a fat-JAR archive on Ubuntu's OpenJDK 21.0.12: -version exit 0,
# application boot SIGSEGV). Fail the build on incompatibility; production
# retains CDS fallback. Temporary JVM files do not become part of the image.
RUN --network=none --mount=type=tmpfs,target=/tmp \
    env -i PATH="$PATH" LANG="$LANG" LC_ALL="$LC_ALL" \
    java -Xshare:on -XX:SharedArchiveFile=application.jsa -Xlog:cds=info \
         -Dspring.context.exit=onRefresh \
         -Dspring.cache.type=redis \
         -Dotel.sdk.disabled=true \
         -jar application.jar

# Kubernetes owns production probes (homelab/TF/gitops/apps/taskflow/backend.yaml
# livenessProbe/readinessProbe), so this target deliberately adds no health
# check; only the local target below has one.

# -----------------------------------------------------------------------------
# local: the docker-compose image (compose builds it with `target: local`).
# Last stage, so it is also the default target of an untargeted build.
# -----------------------------------------------------------------------------
FROM runtime AS local

# Local development: no package layer of its own (tini comes from the shared
# runtime stage). `apt-get upgrade` is intentionally omitted so local rebuilds
# stay cache-friendly and fast, and the base's wget stays installed for the
# HEALTHCHECK below.
USER 10001:10001

# Validate the archive under the final identity and classpath by booting the
# application with it (same check as the prod target). Temporary JVM files do
# not become part of the image.
RUN --network=none --mount=type=tmpfs,target=/tmp \
    env -i PATH="$PATH" LANG="$LANG" LC_ALL="$LC_ALL" \
    java -Xshare:on -XX:SharedArchiveFile=application.jsa -Xlog:cds=info \
         -Dspring.context.exit=onRefresh \
         -Dspring.cache.type=redis \
         -Dotel.sdk.disabled=true \
         -jar application.jar

# Health check for standalone docker run and compose service_healthy dependency.
# Shell form on purpose: `|| exit 1` maps wget's exit codes (4, 8, ...) onto the
# 0/1 contract Docker defines for health checks. hadolint 2.15 reports DL3025
# (meant for CMD/ENTRYPOINT) on HEALTHCHECK's CMD too.
# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s CMD wget -qO /dev/null http://localhost:8080/actuator/health/liveness || exit 1
