#!/bin/sh
# ================================================================================
# TaskFlow Frontend — NGINX Startup Entrypoint
# ================================================================================
# Recreates writable temp directories under the /var/cache/nginx tmpfs mount
# on every container start. The docker-compose tmpfs mount hides any
# directories baked into the image layer, so this script must run at
# container launch before nginx starts.
#
# It also writes resolver.conf (the runtime DNS server nginx-main.conf includes) from
# /etc/resolv.conf, so one image works under Docker Compose and Kubernetes.
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

# Point nginx's runtime resolver at the platform's own DNS server(s). nginx-main.conf
# includes this file. An IPv6 nameserver needs brackets in the resolver directive and
# a zone suffix (fe80::1%eth0) is not accepted, so both are normalised. Fall back to
# Docker's embedded DNS when resolv.conf lists no nameserver. The file is written to
# a temporary name and renamed so nginx never reads a half-written include.
resolvers=$(awk '$1 == "nameserver" {
    a = $2; sub(/%.*/, "", a)
    if (a ~ /:/) a = "[" a "]"
    printf "%s%s", sep, a; sep = " "
}' /etc/resolv.conf 2>/dev/null || true)
[ -n "$resolvers" ] || resolvers=127.0.0.11
printf 'resolver %s ipv6=off valid=30s;\n' "$resolvers" > /var/cache/nginx/resolver.conf.tmp
mv /var/cache/nginx/resolver.conf.tmp /var/cache/nginx/resolver.conf

if [ "$(id -u)" -eq 0 ]; then
    exec nginx -e stderr -g "daemon off; user nginx-runtime;"
fi

exec nginx -e stderr -g "daemon off;"
