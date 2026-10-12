-- DATA-2: remove the demo bookings and reviews from databases that already received them.
--
-- Design (see also db/migration/README.md)
--   * V2__seed_appointments.sql and V11__provision_more_test_data.sql insert fake customers
--     (David Beckham, Keanu Reeves, ...) and fake reviews. They are SEED-ONLY: their files now
--     live in classpath:db/seed, which only dev/test load (application.properties). Their
--     content and version numbers are unchanged, so existing dev/test databases keep validating.
--   * Production loads classpath:db/migration plus THIS folder (classpath:db/prod-cleanup, see
--     application-prod.properties) and sets spring.flyway.ignore-migration-patterns=*:missing,
--     so databases that already applied V2/V11 still validate even though those files are no
--     longer on the classpath. Dev/test never load this folder and therefore keep the demo data.
--   * Fresh production databases never receive the seed rows, so this migration is a no-op
--     there. V3 also hard-codes four public ids for appointments 1-4; for existing databases
--     V23 already re-keyed the seed-uuid-* ids, so the four V3 ids are matched explicitly below.
--
-- Safety: a row is deleted only if it LOOKS like seed data, i.e. it carries one of the known
-- seed public ids, or the exact (customer_email, customer_phone, customer_name) triple of a
-- V2/V11 seed row. Bookings created later by real customers never match. Reviews of the
-- removed appointments are deleted first (reviews.appointment_id is also ON DELETE CASCADE).
-- Not-yet-delivered outbox rows addressed to the seed e-mail addresses are dropped so the relay
-- does not keep retrying example.com recipients; delivered (SENT) history is left untouched.
--
-- Plain ANSI SQL, valid on PostgreSQL and H2 (PostgreSQL mode).

DELETE FROM reviews
WHERE appointment_id IN (
    SELECT a.id FROM appointments a
    WHERE a.public_id LIKE 'seed-uuid-%'
       OR a.public_id IN (
            'f47ac10b-58cc-4372-a567-0e02b2c3d479',
            '9c5b8d1e-2f3a-4b6c-9d7e-1a2b3c4d5e6f',
            '3e7f9a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
            '6a8b0c1d-2e3f-4a5b-7c8d-9e0f1a2b3c4d')
       OR (a.customer_email, a.customer_phone, a.customer_name) IN (
        ('david@example.com', '555-0101', 'David Beckham'),
        ('johnny@example.com', '555-0102', 'Johnny Depp'),
        ('tony@example.com', '555-0199', 'Robert Downey Jr.'),
        ('chris@example.com', '555-0104', 'Chris Evans'),
        ('keanu@example.com', '555-0201', 'Keanu Reeves'),
        ('brad@example.com', '555-0202', 'Brad Pitt'),
        ('george@example.com', '555-0203', 'George Clooney'),
        ('leo@example.com', '555-0204', 'Leonardo DiCaprio'),
        ('ryan@example.com', '555-0205', 'Ryan Gosling'),
        ('christian@example.com', '555-0206', 'Christian Bale'),
        ('tom.hardy@example.com', '555-0207', 'Tom Hardy'),
        ('cillian@example.com', '555-0208', 'Cillian Murphy'),
        ('hugh@example.com', '555-0209', 'Hugh Jackman'),
        ('pedro@example.com', '555-0210', 'Pedro Pascal'),
        ('zendaya@example.com', '555-0211', 'Zendaya Coleman'),
        ('scarlett@example.com', '555-0212', 'Scarlett Johansson'),
        ('thor@example.com', '555-0213', 'Chris Hemsworth'),
        ('matt@example.com', '555-0214', 'Matt Damon'),
        ('ben@example.com', '555-0215', 'Ben Affleck'),
        ('tom.cruise@example.com', '555-0216', 'Tom Cruise'))
);

DELETE FROM appointments
WHERE public_id LIKE 'seed-uuid-%'
   OR public_id IN (
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        '9c5b8d1e-2f3a-4b6c-9d7e-1a2b3c4d5e6f',
        '3e7f9a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
        '6a8b0c1d-2e3f-4a5b-7c8d-9e0f1a2b3c4d')
   OR (customer_email, customer_phone, customer_name) IN (
        ('david@example.com', '555-0101', 'David Beckham'),
        ('johnny@example.com', '555-0102', 'Johnny Depp'),
        ('tony@example.com', '555-0199', 'Robert Downey Jr.'),
        ('chris@example.com', '555-0104', 'Chris Evans'),
        ('keanu@example.com', '555-0201', 'Keanu Reeves'),
        ('brad@example.com', '555-0202', 'Brad Pitt'),
        ('george@example.com', '555-0203', 'George Clooney'),
        ('leo@example.com', '555-0204', 'Leonardo DiCaprio'),
        ('ryan@example.com', '555-0205', 'Ryan Gosling'),
        ('christian@example.com', '555-0206', 'Christian Bale'),
        ('tom.hardy@example.com', '555-0207', 'Tom Hardy'),
        ('cillian@example.com', '555-0208', 'Cillian Murphy'),
        ('hugh@example.com', '555-0209', 'Hugh Jackman'),
        ('pedro@example.com', '555-0210', 'Pedro Pascal'),
        ('zendaya@example.com', '555-0211', 'Zendaya Coleman'),
        ('scarlett@example.com', '555-0212', 'Scarlett Johansson'),
        ('thor@example.com', '555-0213', 'Chris Hemsworth'),
        ('matt@example.com', '555-0214', 'Matt Damon'),
        ('ben@example.com', '555-0215', 'Ben Affleck'),
        ('tom.cruise@example.com', '555-0216', 'Tom Cruise'));

DELETE FROM notification_outbox
WHERE status <> 'SENT'
  AND recipient IN (
    'david@example.com',
    'johnny@example.com',
    'tony@example.com',
    'chris@example.com',
    'keanu@example.com',
    'brad@example.com',
    'george@example.com',
    'leo@example.com',
    'ryan@example.com',
    'christian@example.com',
    'tom.hardy@example.com',
    'cillian@example.com',
    'hugh@example.com',
    'pedro@example.com',
    'zendaya@example.com',
    'scarlett@example.com',
    'thor@example.com',
    'matt@example.com',
    'ben@example.com',
    'tom.cruise@example.com');
