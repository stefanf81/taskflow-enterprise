# Production Nginx Runtime Stage (Security Hardened Non-Root)
FROM nginxinc/nginx-unprivileged:stable-alpine-slim

USER root
ARG APK_BUST=0
# Upgrade Alpine packages to resolve CVEs / security vulnerabilities and install
# Brotli compression module for nginx from Alpine community, plus brotli CLI tool.
# APK_BUST is a cache-busting build arg — pass a unique value (e.g.
# `--build-arg APK_BUST=$(date +%s)`) so this layer is never served from Docker's
# layer cache, ensuring the image always ships the latest Alpine security patches.
# The nginxinc image ships Alpine's nginx; the brotli module is ABI-compatible.
# Insert load_module directives at top of main nginx.conf (must precede events block).
# hadolint ignore=DL3018
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache nginx-mod-http-brotli brotli && \
    sed -i '1i load_module /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so;' /etc/nginx/nginx.conf && \
    sed -i '1i load_module /usr/lib/nginx/modules/ngx_http_brotli_static_module.so;' /etc/nginx/nginx.conf

# Add a startup script that creates nginx temp subdirectories inside the
# /var/cache/nginx tmpfs mount. The docker-compose mounts it as uid=101
# tmpfs, but subdirectories must be created at runtime (tmpfs hides image
# content). Nginx as non-root cannot chown, so we create them first.
RUN printf '#!/bin/sh\nmkdir -p /var/cache/nginx/proxy_temp /var/cache/nginx/client_temp /var/cache/nginx/fastcgi_temp /var/cache/nginx/uwsgi_temp /var/cache/nginx/scgi_temp\n' \
    > /docker-entrypoint.d/40-create-temp-dirs.sh && \
    chmod +x /docker-entrypoint.d/40-create-temp-dirs.sh

# Copy static assets from the pre-built dist directory on host
COPY dist/frontend/browser /usr/share/nginx/html

# Copy our custom Nginx server block configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Pre-compress all compressible static assets at Brotli maximum quality
# (level 11). Uses find + sh -c so missing file types (e.g. no .svg files)
# don't fail the build. Nginx's brotli_static directive will serve these
# .br sidecar files directly, eliminating on-the-fly compression cost.
RUN find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) \
    -exec brotli --best --force {} \;

# Expose HTTP unprivileged port 8080
EXPOSE 8080

# Switch back to the unprivileged nginx user (UID 101). With cap_drop: [ALL]
# in docker-compose, root has no CAP_DAC_OVERRIDE and behaves as a regular
# user — so we run as 101 so the tmpfs mounts (uid=101,gid=101) are writable.
USER 101

# Run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
