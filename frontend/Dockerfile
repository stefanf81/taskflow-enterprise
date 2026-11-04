# syntax=docker/dockerfile:1.28

ARG ALPINE_IMAGE=alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

# =========================================================================================
# STAGE 1: STATIC ASSET COMPRESSION
# =========================================================================================

# Compression is purely data transformation and architecture-independent. Using
# --platform=$BUILDPLATFORM ensures brotli/gzip run at native host CPU speeds, avoiding
# QEMU emulation slowdowns in cross-architecture builds.
FROM --platform=$BUILDPLATFORM ${ALPINE_IMAGE} AS compression

# Fail the CSP hash build if any command in its pipelines fails.
SHELL ["/bin/ash", "-o", "pipefail", "-c"]

RUN apk add --no-cache brotli gzip openssl

WORKDIR /assets

COPY dist/frontend/browser/ ./

# A `script-src 'self'` policy blocks inline scripts, and static files cannot carry a nonce,
# so the exact text of every inline script the build emits is hashed here and authorized as
# a sha384 source expression:
#   - the SRI import map (<script type="importmap">{"integrity":{...}}</script>) on both pages;
#     blocked, it silently discards the integrity hashes of the lazy chunks (the HTML spec
#     forbids `src` on import maps);
#   - on the prerendered landing page (index.html), event replay's dispatch contract
#     (id="ng-event-dispatch-contract") and its `window.__jsaction_bootstrap(...)` call.
# `<script id="ng-state" type="application/json">` is data, not script: CSP does not apply.
# index.csr.html is the client-rendered shell for every other route. The inline JavaScript
# contains `<` and newlines, so awk reads each page whole (RS is \x01, which never occurs)
# and splits it at `<script`/`</script>`. The inventory is pinned per page, in document
# order: the build fails if a script appears, disappears or changes kind, so the served
# hashes cannot drift from the assets and nothing unreviewed is authorized. Update EXPECTED
# (and e2e/csp.spec.ts, which re-hashes the served pages) when Angular changes what it inlines.
# Styles follow the same rule (style-src without 'unsafe-inline', issue #224): templates carry no
# style attributes (a prerendered or static `style="..."` would be refused; bindings that only run
# in the browser go through the CSSOM, which CSP does not restrict). The inline <style> elements
# Angular and the CDK create at runtime are hashed from the chunks that carry their text:
#   - cdk-visually-hidden: the CDK component stylesheet behind cdkTrapFocus (sign-in, receipt);
#   - forms-validity-keyframes: Signal Forms' `@keyframes ng-valid/ng-invalid` probe (found by its
#     text, any `textContent=`...`` literal: Forms 22.2.4 renamed the method that writes it);
#   - the empty <style> the CDK's MediaMatcher appends and then fills through insertRule (CSSOM),
#     authorized by the hash of the empty string, which allows no CSS text at all.
# The inventory (kinds plus the number of createElement(`style`) sites, 4 today: those two, the
# shared component-style host and the unused ShadowDom renderer) is pinned like the scripts': a new
# runtime stylesheet fails the build.
# All forms use HttpClient, never native navigation: form-action 'none' also protects the
# prerendered forms before hydration. Enforce Trusted Types with only the AOT/lazy-load policies.
RUN awk -v dir=/tmp/inline-scripts ' \
        BEGIN { RS = sprintf("%c", 1); system("mkdir -p " dir); } \
        { \
            rest = $0; n = 0; \
            while ((i = index(rest, "<script")) > 0) { \
                rest = substr(rest, i); j = index(rest, ">"); tag = substr(rest, 1, j); \
                rest = substr(rest, j + 1); k = index(rest, "</script>"); \
                body = substr(rest, 1, k - 1); rest = substr(rest, k + 9); \
                if (index(tag, " src=") > 0) continue; \
                if (index(tag, "type=\"application/json\"") > 0) { print FILENAME, "json", "-"; continue; } \
                if (index(tag, "type=\"importmap\"") > 0) kind = "importmap"; \
                else if (index(tag, "id=\"ng-event-dispatch-contract\"") > 0) kind = "event-contract"; \
                else if (index(body, "window.__jsaction_bootstrap(") == 1) kind = "event-bootstrap"; \
                else kind = "unknown"; \
                f = dir "/" FILENAME "." (++n); printf "%s", body > f; close(f); \
                print FILENAME, kind, f; \
            } \
        }' index.html index.csr.html > /tmp/inline-scripts.txt \
    && INVENTORY="$(cut -d' ' -f1,2 /tmp/inline-scripts.txt | tr '\n' ',')" \
    && EXPECTED='index.html importmap,index.html event-contract,index.html event-bootstrap,index.html json,index.csr.html importmap,' \
    && if [ "${INVENTORY}" != "${EXPECTED}" ]; then \
        echo "Unexpected inline <script> inventory (page kind, in document order):" >&2; \
        echo "  found:    ${INVENTORY}" >&2; \
        echo "  expected: ${EXPECTED}" >&2; \
        echo "Review the new inline scripts, then update EXPECTED in frontend/Dockerfile and the hash count in e2e/csp.spec.ts." >&2; \
        exit 1; \
    fi \
    && SCRIPT_HASHES="$(awk '$3 != "-" { print $3 }' /tmp/inline-scripts.txt \
        | while read -r f; do \
            printf "'sha384-%s'\n" "$(openssl dgst -sha384 -binary < "$f" | openssl base64 -A)"; \
        done | sort -u | tr '\n' ' ')" \
    && awk -v dir=/tmp/component-styles ' \
        BEGIN { RS = sprintf("%c", 1); system("mkdir -p " dir); } \
        function sheet(text, kind) { \
            if (index(text, "\\") > 0 || index(text, "${") > 0) kind = "escaped"; \
            f = dir "/" (++n); printf "%s", text > f; close(f); \
            print FILENAME, kind, f; \
        } \
        { \
            rest = $0; \
            while ((i = index(rest, "createElement(`style`)")) > 0) { rest = substr(rest, i + 1); elements++; } \
            rest = $0; \
            while ((i = index(rest, "styles:[")) > 0) { \
                rest = substr(rest, i + 8); \
                if (substr(rest, 1, 1) != "`") { print FILENAME, "not-a-template-literal", "-"; continue; } \
                rest = substr(rest, 2); k = index(rest, "`"); \
                body = substr(rest, 1, k - 1); rest = substr(rest, k + 1); \
                if (substr(rest, 1, 1) != "]") sheet(body, "several-sheets"); \
                else if (index(body, ".cdk-visually-hidden {") == 1) sheet(body, "cdk-visually-hidden"); \
                else sheet(body, "unknown"); \
            } \
            rest = $0; \
            while ((i = index(rest, "textContent=`")) > 0) { \
                rest = substr(rest, i + 13); k = index(rest, "`"); \
                body = substr(rest, 1, k - 1); rest = substr(rest, k + 1); \
                if (index(body, "@keyframes ng-valid {}") > 0) sheet(body, "forms-validity-keyframes"); \
            } \
        } \
        END { print "-", "style-elements:" (elements + 0), "-"; }' ./*.js > /tmp/component-styles.txt \
    && STYLE_INVENTORY="$(cut -d' ' -f2 /tmp/component-styles.txt | sort -u | tr '\n' ',')" \
    && EXPECTED_STYLES='cdk-visually-hidden,forms-validity-keyframes,style-elements:4,' \
    && if [ "${STYLE_INVENTORY}" != "${EXPECTED_STYLES}" ]; then \
        echo "Unexpected runtime stylesheet inventory (kinds, sorted; style-elements = createElement(\`style\`) sites):" >&2; \
        echo "  found:    ${STYLE_INVENTORY}" >&2; \
        echo "  expected: ${EXPECTED_STYLES}" >&2; \
        echo "Angular or a library now injects another inline <style> at runtime, which style-src refuses unless" >&2; \
        echo "it is hashed: review it, then update EXPECTED_STYLES in frontend/Dockerfile and e2e/csp.spec.ts." >&2; \
        exit 1; \
    fi \
    && : > /tmp/component-styles/empty \
    && STYLE_HASHES="$( (awk '$3 != "-" { print $3 }' /tmp/component-styles.txt; echo /tmp/component-styles/empty) \
        | while read -r f; do \
            printf "'sha384-%s'\n" "$(openssl dgst -sha384 -binary < "$f" | openssl base64 -A)"; \
        done | sort -u | tr '\n' ' ')" \
    && printf 'add_header Content-Security-Policy "default-src %s; base-uri %s; form-action %s; frame-ancestors %s; object-src %s; script-src %s %s; style-src %s %s; font-src %s data:; img-src %s data:; connect-src %s; require-trusted-types-for %s; trusted-types angular angular#bundler;" always;\n' \
        "'self'" \
        "'self'" \
        "'none'" \
        "'self'" \
        "'none'" \
        "'self'" \
        "${SCRIPT_HASHES% }" \
        "'self'" \
        "${STYLE_HASHES% }" \
        "'self'" \
        "'self'" \
        "'self'" \
        "'script'" \
        > /csp.conf \
    && cat /csp.conf

# Generate precompressed Brotli and gzip sidecars. nginx.conf serves them with
# brotli_static / gzip_static, so neither is compressed on the fly at runtime.
#
# Brotli quality 11 produces the smallest files. Compression runs in parallel bounded
# to available CPU cores via xargs -P to maximize throughput without unbounded memory usage.
# favicon.ico is bitmap data (image/x-icon, not in brotli_types/gzip_types), so without
# a sidecar every first visit downloaded it raw: 15.1 kB -> 3.7 kB as Brotli.
RUN find . -type f \
        \( \
            -name '*.ico' -o \
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

# CSP snippet generated in the compression stage. It carries the sha384 hashes of
# the exact inline scripts baked into this image; nginx.conf includes it once, at
# server level (add_header_inherit merge reaches every location). `RUN nginx -t` below fails the build if
# this include is missing or the snippet is malformed.
COPY --from=compression /csp.conf /etc/nginx/csp.conf

# Backend address and its resolver (Docker's embedded DNS by default). CI mounts a
# static alternative over this file when the backend runs directly on the runner host.
COPY nginx-upstream-server.conf /etc/nginx/upstream-server.conf

# Empty by default; a deployment behind an ingress mounts its own over this file
# (see the comment at the top of nginx.conf's server block).
COPY nginx-real-ip.conf /etc/nginx/real-ip.conf

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
