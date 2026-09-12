# syntax=docker/dockerfile:1.27

ARG ALPINE_IMAGE=alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

# =========================================================================================
# STAGE 1: STATIC ASSET COMPRESSION
# =========================================================================================

# Compression is purely data transformation and architecture-independent. Using
# --platform=$BUILDPLATFORM ensures brotli/gzip run at native host CPU speeds, avoiding
# QEMU emulation slowdowns in cross-architecture builds.
FROM --platform=$BUILDPLATFORM ${ALPINE_IMAGE} AS compression

RUN apk add --no-cache brotli gzip

WORKDIR /assets

COPY dist/frontend/browser/ ./

# Generate precompressed Brotli and gzip sidecars.
#
# Brotli quality 11 produces the smallest files. Compression runs in parallel bounded
# to available CPU cores via xargs -P to maximize throughput without unbounded memory usage.
RUN find . -type f \
        \( \
            -name '*.js' -o \
            -name '*.mjs' -o \
            -name '*.css' -o \
            -name '*.html' -o \
            -name '*.json' -o \
            -name '*.svg' -o \
            -name '*.xml' -o \
            -name '*.txt' -o \
            -name '*.webmanifest' \
        \) -print0 > /tmp/compress-files.txt \
    && xargs -0 -P "$(nproc)" -n 8 brotli --quality=11 --force < /tmp/compress-files.txt \
    && xargs -0 -P "$(nproc)" -n 16 gzip --best --keep --force < /tmp/compress-files.txt \
    && rm -f /tmp/compress-files.txt


# =========================================================================================
# STAGE 2: SECURITY-HARDENED NGINX RUNTIME
# =========================================================================================

FROM ${ALPINE_IMAGE}

ARG NGINX_UID=10001
ARG NGINX_GID=10001
# CI passes a dynamic APK_BUST (run_id-run_attempt) to pick up Alpine package security
# updates on every CI run while preserving the pinned base image digest. In local builds,
# APK_BUST defaults to "stable" to maximize layer cache reuse.
ARG APK_BUST=stable

# Create a dedicated runtime identity before package installation.
# A high UID avoids collisions with common Alpine system users.
RUN addgroup \
        --system \
        --gid "${NGINX_GID}" \
        nginx-runtime \
    && adduser \
        --system \
        --disabled-password \
        --no-create-home \
        --home /nonexistent \
        --shell /sbin/nologin \
        --uid "${NGINX_UID}" \
        --ingroup nginx-runtime \
        nginx-runtime \
    && : "${APK_BUST}" \
    && apk upgrade --no-cache \
    && apk add --no-cache \
        nginx \
        nginx-mod-http-brotli

# Alpine's Brotli package installs:
#
# /etc/nginx/modules/10_http_brotli.conf
# /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so
# /usr/lib/nginx/modules/ngx_http_brotli_static_module.so
#
# Therefore, do not insert load_module directives manually.

# Create the static HTML root and pre-create temp directories with correct
# ownership. At runtime, the /var/cache/nginx tmpfs mount in docker-compose
# hides these directories, so docker-entrypoint.sh recreates them on every
# container start.
# Note: Static assets in /usr/share/nginx/html remain owned by root:root (default)
# with read-only permissions for defense-in-depth, ensuring the unprivileged
# worker cannot modify or tamper with web assets even if exploited.
RUN mkdir -p \
        /usr/share/nginx/html \
        /var/cache/nginx/client_temp \
        /var/cache/nginx/proxy_temp \
        /var/cache/nginx/fastcgi_temp \
        /var/cache/nginx/uwsgi_temp \
        /var/cache/nginx/scgi_temp \
    && chown -R "${NGINX_UID}:${NGINX_GID}" \
        /var/cache/nginx

# Alpine's Brotli module file uses relative paths that resolve through
# /var/lib/nginx. Replace them with the package's absolute, world-readable
# module location so the unprivileged runtime user can load them.
RUN sed -i \
        -e 's#"modules/ngx_http_brotli_filter_module.so"#"/usr/lib/nginx/modules/ngx_http_brotli_filter_module.so"#' \
        -e 's#"modules/ngx_http_brotli_static_module.so"#"/usr/lib/nginx/modules/ngx_http_brotli_static_module.so"#' \
        /etc/nginx/modules/10_http_brotli.conf

# Static web assets remain owned by root:root with read-only permissions for defense-in-depth.
COPY --from=compression \
    /assets/ \
    /usr/share/nginx/html/

# Main process-level NGINX configuration
COPY nginx-main.conf /etc/nginx/nginx.conf

# Your existing HTTP server block
COPY nginx.conf /etc/nginx/http.d/default.conf

# Default upstream uses Docker's embedded DNS. CI mounts a static alternative
# over this file when the backend runs directly on the runner host.
COPY nginx-upstream-server.conf /etc/nginx/upstream-server.conf

# Startup entrypoint: recreates temp directories on every container start
# (the /var/cache/nginx tmpfs mount hides image-layer directories), then
# execs nginx. PID 1 becomes nginx so it receives signals correctly.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/

# Validate module loading and the complete configuration during the build.
RUN nginx -t

EXPOSE 8080

USER 10001:10001

STOPSIGNAL SIGQUIT

CMD ["/usr/local/bin/docker-entrypoint.sh"]
