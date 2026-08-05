-- Multi-instance outbox safety: introduce a PROCESSING state so the relay can
-- atomically claim rows and guarantee exactly-once delivery across replicas.
--
-- Before this migration the relay read PENDING/FAILED rows without locking,
-- so two instances could load and deliver the same row concurrently.
--
-- New lifecycle:
--   PENDING -> PROCESSING (claimed) -> SENT | FAILED
--   stuck PROCESSING (claimed_at older than the reclaim window) -> PENDING
--
-- claimed_at / claimed_by record which instance owns a row for observability
-- and for the stale-claim reclaim sweep.

ALTER TABLE notification_outbox
    DROP CONSTRAINT IF EXISTS chk_outbox_status;

ALTER TABLE notification_outbox
    ADD CONSTRAINT chk_outbox_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'RETRYING'));

ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_outbox_claim
    ON notification_outbox (status, claimed_at);