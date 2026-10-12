-- DATA-10: tell customers whose "No Preference (First Available)" booking was silently denied.
--
-- V26 assigns a concrete barber to legacy sentinel bookings and sets status = 'DENIED' on every
-- row no barber could serve, but it ran without publishing AppointmentStatusChangedEvent, so no
-- outbox row (and therefore no e-mail) was ever created for those customers. V26 (and V25) have
-- already run in real databases and must not be edited; this forward migration repairs the gap.
--
-- Which rows: status = 'DENIED', barber_name still the sentinel and barber_id NULL (exactly what
-- V26 leaves behind - a row that was assigned has its real barber_name/barber_id), whose booking
-- date is today or later (an apology for a past slot is only noise), and for which no DECLINED
-- notice to that e-mail address mentioning that date exists yet (keeps the migration idempotent
-- and avoids duplicating a notice an admin's manual denial already produced).
--
-- Message: identical wording to NotificationOutboxWriter's DENIED branch, so the customer sees
-- the same e-mail they would have received had the denial gone through the application.
-- Rows are PENDING with retry_count 0 and next_attempt_at NULL (immediately claimable); the
-- relay delivers them after the next start.
--
-- Known limitation: V25 also denies duplicate active bookings (same barber/date/time) but leaves
-- no marker distinguishing those from ordinary admin denials, so they cannot be identified here
-- and their customers are NOT notified.
INSERT INTO notification_outbox (recipient, type, message, sent_at, status, retry_count)
SELECT a.customer_email,
       'EMAIL',
       'Subject: Appointment DECLINED - Dear '
           || REPLACE(REPLACE(a.customer_name, CHR(10), ''), CHR(13), '')
           || ', unfortunately we could not accommodate your '
           || REPLACE(REPLACE(a.service_type, CHR(10), ''), CHR(13), '')
           || ' appointment with '
           || a.barber_name
           || ' on ' || CAST(a.booking_date AS VARCHAR(10))
           || ' at ' || SUBSTRING(CAST(a.booking_time AS VARCHAR(8)), 1, 5)
           || '. Please try booking another slot.',
       CURRENT_TIMESTAMP,
       'PENDING',
       0
FROM appointments a
WHERE a.status = 'DENIED'
  AND a.barber_name = 'No Preference (First Available)'
  AND a.barber_id IS NULL
  AND a.booking_date >= CURRENT_DATE
  AND NOT EXISTS (
      SELECT 1 FROM notification_outbox o
      WHERE o.recipient = a.customer_email
        AND o.message LIKE '%DECLINED%'
        AND o.message LIKE '%' || CAST(a.booking_date AS VARCHAR(10)) || '%');
