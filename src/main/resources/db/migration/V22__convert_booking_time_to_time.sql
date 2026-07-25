-- Convert booking_time from VARCHAR(50) to TIME type for proper chronological sorting.
-- This fixes lexicographic sorting issues (e.g., "9:00" sorting after "10:00").
-- Also adds CHECK constraint on appointments.status to enforce valid enum values.

-- 1. Normalize any existing time strings to HH:mm format (zero-pad single-digit hours)
UPDATE appointments
SET booking_time = LPAD(booking_time, 5, '0')
WHERE LENGTH(booking_time) = 4 AND booking_time LIKE '_:%';

-- 2. Convert booking_time column to TIME type
-- PostgreSQL: USING booking_time::time
-- H2: USING CAST(booking_time AS TIME) (but H2 in PostgreSQL mode supports ::time)
ALTER TABLE appointments
    ALTER COLUMN booking_time TYPE TIME
    USING booking_time::time;

-- 3. Add CHECK constraint on appointments.status to enforce valid enum values
-- (PENDING, APPROVED, DENIED). This prevents invalid status values from being persisted.
ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS chk_appointment_status;

ALTER TABLE appointments
    ADD CONSTRAINT chk_appointment_status
    CHECK (status IN ('PENDING', 'APPROVED', 'DENIED'));