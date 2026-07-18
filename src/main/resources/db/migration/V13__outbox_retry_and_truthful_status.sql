-- C3: Transactional outbox hardening.
-- Add a retry counter so the relay can track delivery attempts and a truthful
-- status lifecycle (PENDING -> SENT | FAILED). Historical rows were written as
-- SENT by the previous implementation; we cannot retroactively prove delivery,
-- so they are left as-is. New rows start as PENDING and are resolved by the
-- NotificationRelayScheduler.

ALTER TABLE notification_outbox ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
