#!/bin/sh
# ================================================================================
# TaskFlow Frontend — NGINX Startup Entrypoint
# ================================================================================
# Recreates writable temp directories under the /var/cache/nginx tmpfs mount
# on every container start. The docker-compose tmpfs mount hides any
# directories baked into the image layer, so this script must run at
# container launch before nginx starts.
#
# After creating the directories, execs nginx to replace the shell process
# (PID 1 becomes nginx, ensuring it receives signals properly).
# ================================================================================

set -e

mkdir -p \
    /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp

exec nginx -g "daemon off;"
