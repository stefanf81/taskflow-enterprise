# Database migrations

Flyway applies versioned migrations (`V<n>__<description>.sql`, or Java classes in
`src/main/java/db/migration`) in version order. **A migration that has been released is
immutable**: Flyway stores a checksum per applied migration and refuses to start when the file
changes. Fix mistakes with a new, higher-numbered migration.

## Where migrations live

| Location (classpath) | Loaded by | Contents |
| --- | --- | --- |
| `db/migration` (+ `db/migration/*.java` in package `db.migration`) | every environment | schema, reference data production needs (services V5, barbers + schedules V6, users) |
| `db/seed` | dev/test only (`application.properties`) | **seed-only** demo data: `V2__seed_appointments.sql`, `V11__provision_more_test_data.sql` (fake bookings and reviews) |
| `db/prod-cleanup` | production only (`application-prod.properties`) | prod-only forward migrations, currently `V30__remove_seed_data.sql` |

`spring.flyway.locations` is `classpath:db/migration,classpath:db/seed` by default and
`classpath:db/migration,classpath:db/prod-cleanup` under the `prod` profile, which also sets
`spring.flyway.ignore-migration-patterns=*:missing,*:future`.

Consequences:

* A **fresh production database** never receives the demo appointments/reviews (V2/V11 are not
  on its classpath). Everything else must therefore work **without** V2/V11 - never make a
  migration in `db/migration` depend on rows inserted by a seed migration.
* A **production database that already applied V2/V11** still validates (`*:missing` ignores the
  now-absent files) and `V30` deletes the demo rows (matched by their known public ids and the exact
  e-mail/phone/name triples, so real customers are never touched).
* **Dev/test** keep the demo data and never run the prod-cleanup folder.
* Seed files were moved, not edited: contents, version numbers and checksums are unchanged.
* New seed data goes into `db/seed` (and must not be needed by any later migration); new
  prod-only repairs go into `db/prod-cleanup`. Version numbers are shared across all locations, so
  pick the next free one.

`DataMigrationsTest` (H2) migrates a fresh database with the production layout and with the dev
layout, checks the schema validates (`ProductionLayoutContextTest`), and runs the V30 cleanup on a
database that had the seed rows. The same scenarios run against PostgreSQL when
`TASKFLOW_TEST_POSTGRES_URL` is set (`DataMigrationsPostgresTest`).

## Numbering conventions

* Versions are plain integers, strictly increasing, no reuse.
* **There is intentionally no `V16`.** A V16 public-id repair was written but never discovered by
  Flyway, so it was never applied; its replacement was shipped forward as
  `V23__ReseedPublicIds.java` (see that class's Javadoc). The gap is deliberate. Do **not**
  add a `V16`: databases that already applied V17 and later would fail Flyway validation
  (`Detected resolved migration not applied to database`) or require `outOfOrder`.
* Use a Java migration (`BaseJavaMigration`) when SQL differs between PostgreSQL and H2: branch on
  `connection.getMetaData().getDatabaseProductName()` (see V21, V25, V32). PostgreSQL gets the real
  partial / expression index; H2 gets a generated-column emulation.
* Keep SQL valid on both engines (H2 runs in PostgreSQL mode in dev/test): `ADD COLUMN IF NOT
  EXISTS`, `DROP INDEX IF EXISTS`, correlated sub-queries instead of `UPDATE ... FROM`.
* Say in the file header what the migration does, why, and what it cannot do (see V33 for an
  example of documenting a limitation).
* Do not touch email indexes or the appointment slot index outside the booking migrations.

## Index of recent data-integrity migrations

| Version | What |
| --- | --- |
| V30 (prod-cleanup) | delete the demo bookings/reviews from databases that already had them |
| V31 | `notification_outbox.next_attempt_at` (nullable) for retry backoff |
| V32 (Java) | `services.active` + collapse case-insensitive duplicate service names + unique `lower(name)` |
| V33 | PENDING "declined" notices for sentinel bookings V26 denied silently |
| V34 | drop unused indexes (`idx_reviews_rating_created`, `idx_appointments_service_type`, `idx_appointment_customer_name`) |
