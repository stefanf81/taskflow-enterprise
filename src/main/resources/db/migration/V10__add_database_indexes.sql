-- Optimize customer dashboard appointment fetches
CREATE INDEX idx_appointments_customer_email ON appointments (customer_email);

-- Optimize barber busy slot check (runs on every guest calendar interaction)
CREATE INDEX idx_barber_time_off_composite ON barber_time_off (barber_id, start_date, end_date);

-- Optimize outbox queries sorted by sent_at
CREATE INDEX idx_notification_outbox_sent_at ON notification_outbox (sent_at DESC);
