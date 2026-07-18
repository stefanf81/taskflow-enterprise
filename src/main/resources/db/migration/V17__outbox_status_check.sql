-- T6: Enforce a truthful, bounded lifecycle on the transactional outbox.
-- notification_outbox.status was a free-text VARCHAR(50) with no constraint, so a
-- bug could persist an arbitrary status and poison the relay's state machine.
-- We constrain it to the only four states the NotificationRelayScheduler knows
-- about (PENDING -> SENT | FAILED | RETRYING) and cap retry_count so a stuck row
-- cannot loop forever. retry_count defaults to 0 (added in V13), satisfying the
-- lower bound. CHECK constraints are supported by H2 and PostgreSQL.
ALTER TABLE notification_outbox
    DROP CONSTRAINT IF EXISTS chk_outbox_status;

ALTER TABLE notification_outbox
    ADD CONSTRAINT chk_outbox_status
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING'));

ALTER TABLE notification_outbox
    DROP CONSTRAINT IF EXISTS chk_outbox_retry;

ALTER TABLE notification_outbox
    ADD CONSTRAINT chk_outbox_retry
    CHECK (retry_count >= 0 AND retry_count <= 10);
