ALTER TABLE appointments ADD COLUMN reminder_sent BOOLEAN DEFAULT FALSE;

CREATE TABLE notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    recipient VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    sent_at TIMESTAMP NOT NULL,
    status VARCHAR(50) NOT NULL
);