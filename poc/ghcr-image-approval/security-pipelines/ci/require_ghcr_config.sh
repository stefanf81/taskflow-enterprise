#!/usr/bin/env bash
# Fail closed on a wrong registry, owner or package path before using credentials.
set -Eeuo pipefail
: "${GHCR_HOST:?}" "${GHCR_NAMESPACE:?}"
[[ "$GHCR_HOST" == ghcr.io ]] || { echo 'Only ghcr.io is allowed' >&2; exit 1; }
[[ "$GHCR_NAMESPACE" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo 'Invalid lowercase GHCR_NAMESPACE' >&2; exit 1; }
case "${1:-}" in
  base)
    [[ "${GHCR_APPROVED_REPO:-}" == "ghcr.io/$GHCR_NAMESPACE/approved/eclipse-temurin" ]] || exit 1
    [[ "${GHCR_QUARANTINE_REPO:-}" == "ghcr.io/$GHCR_NAMESPACE/quarantine/eclipse-temurin" ]] || exit 1
    ;;
  app)
    : "${APP_NAME:?}"
    [[ "$APP_NAME" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo 'Invalid APP_NAME' >&2; exit 1; }
    [[ "${APP_CANDIDATE_REPO:-}" == "ghcr.io/$GHCR_NAMESPACE/application-candidates/$APP_NAME" ]] || exit 1
    [[ "${APP_RELEASE_REPO:-}" == "ghcr.io/$GHCR_NAMESPACE/applications/$APP_NAME" ]] || exit 1
    [[ "${APPROVED_PREFIX:-}" == "ghcr.io/$GHCR_NAMESPACE/approved/" ]] || exit 1
    ;;
  *) echo 'Usage: require_ghcr_config.sh {base|app}' >&2; exit 2 ;;
esac
