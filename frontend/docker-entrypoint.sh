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
#
# -e stderr: before the configuration is read, nginx opens its compiled-in error
# log. Alpine builds nginx with --prefix=/var/lib/nginx and ships that directory
# as mode 750 owned by the package's nginx user, so UID 10001 cannot open it and
# every start would log "[alert] could not open error log file". Pointing the
# pre-config log at stderr keeps every error on the container's stderr stream.
#
# Root start: the image runs as UID 10001 (USER in the Dockerfile), where nginx
# ignores a `user` directive with a warning, so nginx-main.conf carries none. If
# the user is overridden to root (`docker run --user 0`, a pod with runAsUser:
# 0), the `user` directive is added on the command line instead, so the workers
# still drop to the unprivileged nginx-runtime account; the root master chowns
# the temp paths under /var/cache/nginx to it. Without that, workers would run
# as Alpine's compiled-in `nginx` user, which cannot write the 10001-owned temp
# directories, and large proxied responses would fail.
# ================================================================================

set -e

mkdir -p \
    /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp

if [ "$(id -u)" -eq 0 ]; then
    exec nginx -e stderr -g "daemon off; user nginx-runtime;"
fi

exec nginx -e stderr -g "daemon off;"
