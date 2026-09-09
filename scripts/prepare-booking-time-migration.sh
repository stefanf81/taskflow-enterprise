#!/usr/bin/env bash
# Prepares legacy VARCHAR booking_time data before Flyway V21/V22 runs.
# Run inside one Kubernetes PreSync Job with the PostgreSQL client available.
set -euo pipefail

usage() {
  printf '%s\n' "Usage: $0 [--dry-run|--apply]"
  printf '%s\n' "Requires PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD."
}

mode='dry-run'
case "${1:---dry-run}" in
  --dry-run) ;;
  --apply) mode='apply' ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

for variable in PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$variable" >&2
    exit 2
  fi
done

psql_cmd=(psql -X -q -v ON_ERROR_STOP=1)
history="$("${psql_cmd[@]}" -Atc "
  SELECT COALESCE(string_agg(version || ':' || success, ',' ORDER BY installed_rank), '')
  FROM flyway_schema_history
  WHERE version IN ('21', '22');")"
column_type="$("${psql_cmd[@]}" -Atc "
  SELECT data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'appointments'
    AND column_name = 'booking_time';")"

printf 'Flyway V21/V22 history: %s\n' "${history:-pending}"
printf 'appointments.booking_time type: %s\n' "${column_type:-missing}"

if [[ "$history" == *'21:false'* || "$history" == *'22:false'* ]]; then
  printf '%s\n' 'A V21/V22 migration previously failed. Inspect and repair Flyway state manually.' >&2
  exit 1
fi

if [[ "$history" == *'22:true'* ]]; then
  if [[ "$column_type" != time* ]]; then
    printf '%s\n' 'V22 is recorded as successful but booking_time is not TIME. Refusing to continue.' >&2
    exit 1
  fi
  printf '%s\n' 'V22 is already complete; no legacy text data cleanup is required.'
  exit 0
fi

if [[ "$column_type" != 'character varying' && "$column_type" != 'text' ]]; then
  printf '%s\n' 'booking_time is neither legacy text nor TIME. Refusing to mutate an unknown schema.' >&2
  exit 1
fi

printf '%s\n' 'Legacy data preflight:'
"${psql_cmd[@]}" -P pager=off -c "
  SELECT id, booking_time, status
  FROM appointments
  WHERE trim(booking_time) !~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$'
     OR status NOT IN ('PENDING', 'APPROVED', 'DENIED')
  ORDER BY id;"

if [[ "$mode" == 'dry-run' ]]; then
  printf '%s\n' 'Dry run only. Re-run with --apply after a verified database backup.'
  exit 0
fi

"${psql_cmd[@]}" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('taskflow-booking-time-preparation'));

-- V22 adds this status constraint. Preserve legacy records but make them valid.
UPDATE appointments
SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP
WHERE status NOT IN ('PENDING', 'APPROVED', 'DENIED');

-- Malformed time text cannot be converted to TIME safely. Deny active rows so
-- they no longer reserve a bookable slot, but retain the appointment for audit.
UPDATE appointments
SET booking_time = '00:00',
    status = CASE WHEN status IN ('PENDING', 'APPROVED') THEN 'DENIED' ELSE status END,
    updated_at = CURRENT_TIMESTAMP
WHERE trim(booking_time) !~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$';

-- Canonical strings let V21 compare slots without dialect-specific casts and
-- ensure V22 can convert the column to TIME.
UPDATE appointments
SET booking_time = LPAD(split_part(trim(booking_time), ':', 1), 2, '0')
                    || ':' || split_part(trim(booking_time), ':', 2),
    updated_at = CURRENT_TIMESTAMP
WHERE trim(booking_time) ~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE booking_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       OR status NOT IN ('PENDING', 'APPROVED', 'DENIED')
  ) THEN
    RAISE EXCEPTION 'Legacy appointment cleanup verification failed';
  END IF;
END $$;
COMMIT;
SQL

printf '%s\n' 'Legacy booking-time cleanup completed. Deploy the backend release so Flyway can apply V21/V22.'
