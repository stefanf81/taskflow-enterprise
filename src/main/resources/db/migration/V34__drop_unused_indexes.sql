-- DATA-11: drop indexes no query can use; each one still costs write throughput and storage.
--
--   idx_reviews_rating_created (V19, reviews(rating, created_at))
--       Written for a "top-rated, newest first" listing that does not exist. The only review
--       queries are existsByAppointmentId (served by the UNIQUE appointment_id constraint) and
--       the per-barber AVG/COUNT aggregate, which scans the table and groups by barber.
--   idx_appointments_service_type (V14, appointments(service_type))
--       Created for a stats join on service_type; V15 moved that join to service_id
--       (idx_appointments_service_id). Nothing filters on service_type.
--   idx_appointment_customer_name (V1, appointments(customer_name))
--       The only name query is findByCustomerNameContainingIgnoreCase, i.e.
--       lower(customer_name) LIKE '%term%': a leading wildcard on a lower() expression can never
--       use a plain b-tree index on customer_name.
--
-- The lower(customer_email) indexes are owned by the booking migrations and untouched here.
-- DROP INDEX IF EXISTS is valid on H2 and PostgreSQL and keeps the migration re-runnable.
-- NOTE: Appointment.java still lists idx_appointments_service_type and
-- idx_appointment_customer_name in @Table(indexes); that metadata is not validated by
-- ddl-auto=validate, but should be removed from the entity to match.
DROP INDEX IF EXISTS idx_reviews_rating_created;
DROP INDEX IF EXISTS idx_appointments_service_type;
DROP INDEX IF EXISTS idx_appointment_customer_name;
