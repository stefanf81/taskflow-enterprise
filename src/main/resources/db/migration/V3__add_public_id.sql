ALTER TABLE appointments ADD COLUMN public_id VARCHAR(36);

-- Assign real, unguessable UUIDs to the seed rows (no enumerable placeholders like
-- 'seed-uuid-N'). The values below are fixed literals so the migration is portable
-- across H2 (dev/test) and PostgreSQL (prod) without relying on a DB-specific UUID
-- function. New appointments get a UUID automatically via Appointment.@PrePersist.
UPDATE appointments SET public_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479' WHERE id = 1;
UPDATE appointments SET public_id = '9c5b8d1e-2f3a-4b6c-9d7e-1a2b3c4d5e6f' WHERE id = 2;
UPDATE appointments SET public_id = '3e7f9a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b' WHERE id = 3;
UPDATE appointments SET public_id = '6a8b0c1d-2e3f-4a5b-7c8d-9e0f1a2b3c4d' WHERE id = 4;

ALTER TABLE appointments ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX idx_appointment_public_id ON appointments(public_id);
