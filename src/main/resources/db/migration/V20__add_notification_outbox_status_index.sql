-- M10: Add composite index on notification_outbox for the relay scheduler query.
-- The scheduler queries: findByStatus("PENDING") and
-- findByStatusAndRetryCountLessThan("FAILED", maxRetries). Without an index,
-- every relay sweep performs a full table scan on the outbox.

CREATE INDEX idx_notification_outbox_status_retry
    ON notification_outbox (status, retry_count);
