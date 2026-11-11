-- Index for the admin listing's order, and indexes no query uses.
--
--   Added   idx_appointments_date_time_id ON appointments(booking_date, booking_time, id)
--       The admin listing's complete sort key (newest first; id breaks ties between barbers
--       sharing a slot). With only booking_date indexed, PostgreSQL re-sorted every date and an
--       offset deep into the history read the whole prefix: 52 ms at offset 50,000 and 167 ms on
--       the last page of 180k rows, against 19 and 62 ms read straight from this index; the first
--       page drops from 1.1 ms to 0.04 ms (scanned backwards).
--   Dropped idx_appointments_booking_date (V14)
--       A prefix of the new index, which serves every query it served.
--   Dropped idx_appointment_status (V1)
--       A prefix of idx_appointment_status_date, which every status filter uses.
--   Dropped idx_appointment_barber_date (V1)
--       The per-barber queries read only PENDING/APPROVED rows, which the partial slot index
--       idx_appointment_slot_active (barber_name, booking_date, booking_time) answers in order.
--
-- Measured on PostgreSQL 16 with 180k appointments, every query of the application under
-- EXPLAIN ANALYZE: neither dropped V1 index was scanned once, and they made a 20k-row status
-- update ~30% slower. The plain customer_email index is just as unused but belongs to the booking
-- migrations (db/migration/README.md); it stays.
--
-- The index is built inside the migration transaction, which blocks writes to appointments for
-- the build: 86 ms at 180k rows. Not CONCURRENTLY: Flyway keeps a transaction open on its own
-- connection while it migrates, and a concurrent build waits for that transaction forever.
-- IF [NOT] EXISTS is valid on H2 and PostgreSQL and keeps the migration re-runnable.
CREATE INDEX IF NOT EXISTS idx_appointments_date_time_id ON appointments (booking_date, booking_time, id);
DROP INDEX IF EXISTS idx_appointments_booking_date;
DROP INDEX IF EXISTS idx_appointment_status;
DROP INDEX IF EXISTS idx_appointment_barber_date;
