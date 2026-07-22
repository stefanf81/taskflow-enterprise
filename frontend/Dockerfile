# Production Nginx Runtime Stage (Security Hardened Non-Root)
FROM nginxinc/nginx-unprivileged:stable-alpine-slim

USER root
# Upgrade Alpine packages to resolve CVEs / security vulnerabilities.
# APK_BUST is a cache-busting build arg — pass a unique value (e.g.
# `--build-arg APK_BUST=$(date +%s)`) so this layer is never served
# from Docker's layer cache, ensuring the image always ships the
# latest Alpine security patches.
ARG APK_BUST=0
RUN apk update && apk upgrade --no-cache
USER 101

# Copy static assets from the pre-built dist directory on host
COPY dist/frontend/browser /usr/share/nginx/html

# Copy our custom Nginx server block configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP unprivileged port 8080
EXPOSE 8080

# Run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
