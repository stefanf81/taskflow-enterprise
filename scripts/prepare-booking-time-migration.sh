#!/usr/bin/env bash
# Prepares legacy VARCHAR booking_time data before Flyway V21/V22 runs.
# Run inside one Kubernetes PreSync Job with the PostgreSQL client available.
#
# What --apply does, in ONE transaction (any failure rolls everything back):
#   1. drops the legacy 4-column slot index idx_appointment_slot (V21 drops it as its first step
#      anyway) - it forbids rows this cleanup legitimately produces, e.g. two DENIED rows that
#      end up on the same canonical slot - and installs a PARTIAL unique index of the same name
#      over PENDING/APPROVED rows only, so double-booking stays impossible until V21 replaces it;
#   2. makes unknown statuses valid (-> DENIED) and denies rows whose time text is malformed;
#   3. canonicalises 9:00 -> 09:00;
#   4. resolves active-slot collisions that canonicalising (or the legacy index, which included
#      `status` and so allowed PENDING+APPROVED at one slot) left behind: per
#      (barber_name, booking_date, time) the APPROVED row wins, otherwise the earliest (lowest id)
#      PENDING row - the same keep rule V25 applies - and every other active row becomes DENIED,
#      so V21's CREATE UNIQUE INDEX cannot fail;
#   5. asserts no duplicate active slot remains before COMMIT, else aborts with a clear message.
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

printf '%s\n' 'Active-slot collisions that --apply would resolve (the first id of each group is kept):'
"${psql_cmd[@]}" -P pager=off -c "
  SELECT barber_name, booking_date, canonical_time,
         string_agg(id || ':' || status, ', ' ORDER BY (status = 'APPROVED') DESC, id) AS rows_keep_first
  FROM (
    SELECT id, status, barber_name, booking_date,
           LPAD(split_part(trim(booking_time), ':', 1), 2, '0') || ':' || split_part(trim(booking_time), ':', 2) AS canonical_time
    FROM appointments
    WHERE status IN ('PENDING', 'APPROVED')
      AND trim(booking_time) ~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$'
  ) active
  GROUP BY barber_name, booking_date, canonical_time
  HAVING COUNT(*) > 1
  ORDER BY booking_date, barber_name, canonical_time;"

if [[ "$mode" == 'dry-run' ]]; then
  printf '%s\n' 'Dry run only. Re-run with --apply after a verified database backup.'
  exit 0
fi

"${psql_cmd[@]}" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('taskflow-booking-time-preparation'));

-- 1. The legacy index is UNIQUE (barber_name, booking_date, booking_time, status). Denying a
--    duplicate or canonicalising a time can legitimately produce two DENIED rows on one slot,
--    which that index would reject. V21 drops it anyway; swap it for a partial index over active
--    rows under the same name (V21's DROP INDEX IF EXISTS removes it) so the slot stays protected.
DROP INDEX IF EXISTS idx_appointment_slot;

-- 2. V22 adds a status constraint. Preserve legacy records but make them valid.
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

-- 3. Canonical strings let V21 compare slots without dialect-specific casts and
--    ensure V22 can convert the column to TIME.
UPDATE appointments
SET booking_time = LPAD(split_part(trim(booking_time), ':', 1), 2, '0')
                    || ':' || split_part(trim(booking_time), ':', 2),
    updated_at = CURRENT_TIMESTAMP
WHERE trim(booking_time) ~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$';

-- 4. Canonicalising may have put two active rows on one slot ('9:00' and '09:00'), and the legacy
--    index let PENDING and APPROVED rows share a slot. Keep one row per active slot - the APPROVED
--    one, else the earliest PENDING one (lowest id) - and deny the rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY barber_name, booking_date, booking_time
           ORDER BY (status = 'APPROVED') DESC, id) AS keep_rank
  FROM appointments
  WHERE status IN ('PENDING', 'APPROVED')
)
UPDATE appointments
SET status = 'DENIED', updated_at = CURRENT_TIMESTAMP
FROM ranked
WHERE appointments.id = ranked.id AND ranked.keep_rank > 1;

-- 5. Verify before committing: canonical times, valid statuses, and no duplicate active slot
--    (the condition V21's CREATE UNIQUE INDEX needs).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE booking_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
       OR status NOT IN ('PENDING', 'APPROVED', 'DENIED')
  ) THEN
    RAISE EXCEPTION 'Legacy appointment cleanup verification failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE status IN ('PENDING', 'APPROVED')
    GROUP BY barber_name, booking_date, booking_time
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate PENDING/APPROVED appointments remain for the same barber, date and time; refusing to commit (V21 would fail to create its unique index)';
  END IF;
END $$;

-- Interim protection until V21 replaces it (see step 1).
CREATE UNIQUE INDEX idx_appointment_slot
  ON appointments (barber_name, booking_date, booking_time)
  WHERE status IN ('PENDING', 'APPROVED');
COMMIT;
SQL

printf '%s\n' 'Legacy booking-time cleanup completed. Deploy the backend release so Flyway can apply V21/V22.'
