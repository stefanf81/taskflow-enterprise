-- Per-review rating inputs (ADR-022, decision 5 and its noted follow-up).
--
-- The public barber-ratings endpoint read every (appointment_id, rating) pair and asked the
-- appointment module for the barber of each appointment that is still APPROVED: one IN query per
-- 512 reviews, on every request. A review now carries what the aggregate needs, so it is a single
-- GROUP BY inside the review module:
--
--   barber_name  the reviewed appointment's barber. An appointment's barber never changes once it
--                is booked (No Preference is resolved before the row is written).
--   counted      whether the reviewed appointment is still APPROVED; only those reviews count.
--
-- The review module keeps `counted` current from AppointmentStatusChangedEvent and
-- AppointmentCancelledEvent, in the transaction that changes the status. A later migration that
-- rewrites appointments.status or appointments.barber_name of reviewed appointments must update
-- these columns too.
--
-- Valid on H2 and PostgreSQL: correlated sub-queries instead of UPDATE ... FROM.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS barber_name VARCHAR(100);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS counted BOOLEAN DEFAULT FALSE NOT NULL;

UPDATE reviews SET
    barber_name = (SELECT a.barber_name FROM appointments a WHERE a.id = reviews.appointment_id),
    counted = CASE
        WHEN EXISTS (SELECT 1 FROM appointments a
                     WHERE a.id = reviews.appointment_id AND a.status = 'APPROVED') THEN TRUE
        ELSE FALSE
    END;

-- reviews.appointment_id is NOT NULL with a foreign key, and appointments.barber_name is NOT NULL.
ALTER TABLE reviews ALTER COLUMN barber_name SET NOT NULL;
