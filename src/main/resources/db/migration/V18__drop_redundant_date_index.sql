-- T7: Drop the redundant booking_date index.
-- V1 created idx_appointment_date ON appointments(booking_date). V14 later added
-- idx_appointments_booking_date for reminder sweeps — a duplicate of the same
-- single-column index. Keeping both wastes write throughput and storage and
-- confuses the planner. We drop the legacy V1 index (the V14 one is the
-- canonical one). DROP INDEX IF EXISTS is supported by H2 and PostgreSQL and
-- keeps this migration idempotent on re-apply.
DROP INDEX IF EXISTS idx_appointment_date;
