ALTER TABLE appointments ADD COLUMN public_id VARCHAR(36);

UPDATE appointments SET public_id = 'seed-uuid-1' WHERE id = 1;
UPDATE appointments SET public_id = 'seed-uuid-2' WHERE id = 2;
UPDATE appointments SET public_id = 'seed-uuid-3' WHERE id = 3;
UPDATE appointments SET public_id = 'seed-uuid-4' WHERE id = 4;

UPDATE appointments SET public_id = 'temp-uuid-' || id WHERE public_id IS NULL;

ALTER TABLE appointments ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX idx_appointment_public_id ON appointments(public_id);
