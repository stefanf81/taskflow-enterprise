# syntax=docker/dockerfile:1.26

ARG ALPINE_VERSION=3.24.1

# =========================================================================================
# STAGE 1: STATIC ASSET COMPRESSION
# =========================================================================================

FROM alpine:${ALPINE_VERSION} AS compression

RUN apk add --no-cache brotli gzip

WORKDIR /assets

COPY dist/frontend/browser/ ./

# Generate precompressed Brotli and gzip sidecars.
#
# Brotli quality 11 produces the smallest files but takes considerably longer.
# Change to --quality=10 if CI build time becomes a concern.
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
        \) \
        -exec brotli --quality=11 --force {} \; \
    && find . -type f \
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
        \) \
        -exec gzip --best --keep --force {} \;


# =========================================================================================
# STAGE 2: SECURITY-HARDENED NGINX RUNTIME
# =========================================================================================

FROM alpine:${ALPINE_VERSION}

ARG NGINX_UID=10001
ARG NGINX_GID=10001
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
RUN mkdir -p \
        /usr/share/nginx/html \
        /var/cache/nginx/client_temp \
        /var/cache/nginx/proxy_temp \
        /var/cache/nginx/fastcgi_temp \
        /var/cache/nginx/uwsgi_temp \
        /var/cache/nginx/scgi_temp \
    && chown -R "${NGINX_UID}:${NGINX_GID}" \
        /usr/share/nginx/html \
        /var/cache/nginx

# Alpine's Brotli module file uses relative paths that resolve through
# /var/lib/nginx. Replace them with the package's absolute, world-readable
# module location so the unprivileged runtime user can load them.
RUN sed -i \
        -e 's#"modules/ngx_http_brotli_filter_module.so"#"/usr/lib/nginx/modules/ngx_http_brotli_filter_module.so"#' \
        -e 's#"modules/ngx_http_brotli_static_module.so"#"/usr/lib/nginx/modules/ngx_http_brotli_static_module.so"#' \
        /etc/nginx/modules/10_http_brotli.conf

COPY --from=compression \
    --chown=${NGINX_UID}:${NGINX_GID} \
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
