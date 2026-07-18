-- P3: Index join/filter columns used by the dashboard stats query
-- (AppointmentRepository.getAppointmentStats joins appointments.service_type to
-- ServiceItem.name and filters on appointments.booking_date) and by the reminder
-- scheduler. Previously unindexed, causing full scans at scale.
CREATE INDEX idx_appointments_service_type ON appointments (service_type);
CREATE INDEX idx_appointments_booking_date ON appointments (booking_date);
