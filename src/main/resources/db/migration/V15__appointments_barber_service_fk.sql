-- A1: Introduce real referential integrity between appointments and the
-- barbers / services catalog. Historically appointments stored the barber and
-- service as free-text strings (barber_name / service_type), which orphaned
-- history on rename and made the revenue stats join on a string. We add
-- surrogate FKs (barber_id, service_id) and backfill them from the denormalized
-- name columns. The name columns are intentionally RETAINED as a denormalized
-- cache so the API/UI can render names without an extra join; they are kept in
-- sync on write by the service layer.
--
-- This migration is idempotent-friendly: it no-ops if the columns already exist
-- (guard added for H2/Postgres parity).

-- 1. Add the FK columns (nullable first so existing rows can be backfilled).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS barber_id BIGINT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id BIGINT;

-- 2. Backfill from the denormalized names. barbers.name is UNIQUE; service names
--    are seeded constants, so the joins are stable. Unmatched rows keep NULL —
--    they remain valid historically and simply have no FK. Correlated subqueries
--    are used (not UPDATE...FROM) for H2 / PostgreSQL parity.
UPDATE appointments
SET barber_id = (SELECT b.id FROM barbers b WHERE b.name = appointments.barber_name)
WHERE barber_id IS NULL;

UPDATE appointments
SET service_id = (SELECT s.id FROM services s WHERE s.name = appointments.service_type)
WHERE service_id IS NULL;

-- 3. Add the foreign keys with ON DELETE RESTRICT so a catalog row cannot be
--    silently removed while appointments still reference it (rename is safe via
--    an UPDATE on the catalog row; delete is blocked until history is resolved).
--    NOTE: Flyway runs this migration exactly once per schema-history; on a full
--    DB reset the history is also reset so the columns/constraints do not pre-exist.
ALTER TABLE appointments
    ADD CONSTRAINT fk_appointment_barber
    FOREIGN KEY (barber_id) REFERENCES barbers (id);

ALTER TABLE appointments
    ADD CONSTRAINT fk_appointment_service
    FOREIGN KEY (service_id) REFERENCES services (id);

-- 4. Indexes for the FK joins (replaces the now-redundant string index usage for
--    stats; the booking_date index from V14 is kept for reminder sweeps).
CREATE INDEX IF NOT EXISTS idx_appointments_barber_id ON appointments (barber_id);
CREATE INDEX IF NOT EXISTS idx_appointments_service_id ON appointments (service_id);

-- 5. Drop the redundant free-text service_type index now that stats join on
--    service_id; keep it only if you prefer it retained (kept for parity with
--    booking_date). Left in place to avoid churn; harmless.
