-- Optimize overdue appointment check queries
CREATE INDEX idx_appointment_status_date ON appointments(status, booking_date);
