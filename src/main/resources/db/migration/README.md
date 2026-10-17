# Database migrations

Flyway applies versioned migrations (`V<n>__<description>.sql`, or Java classes in
`src/main/java/db/migration`) in version order. **A migration that has been released is
immutable**: Flyway stores a checksum per applied migration and refuses to start when the file
changes. Fix mistakes with a new, higher-numbered migration.

## Where migrations live

| Location (classpath) | Loaded by | Contents |
| --- | --- | --- |
| `db/migration` (+ `db/migration/*.java` in package `db.migration`) | every environment | schema, reference data production needs (services V5, barbers + schedules V6, users) |
| `db/seed` | every environment (production deletes its rows again in V30) | **seed-only** demo data: `V2__seed_appointments.sql`, `V11__provision_more_test_data.sql` (fake bookings and reviews) |
| `db/prod-cleanup` | production only (`application-prod.properties`) | prod-only forward migrations, currently `V30__remove_seed_data.sql` |

`spring.flyway.locations` is `classpath:db/migration,classpath:db/seed` by default and
`classpath:db/migration,classpath:db/seed,classpath:db/prod-cleanup` under the `prod` profile.
Only Flyway's default `*:future` is ignored: the missing-migration check stays on everywhere, so a
deleted or renamed applied migration fails startup instead of passing silently.

Consequences:

* A **production database** - fresh or one that applied V2/V11 long ago - ends up without the demo
  appointments/reviews: `V30` deletes them (matched by their known public ids and the exact
  e-mail/phone/name triples, so real customers are never touched). Migrations in `db/migration`
  must still work **without** V2/V11 (that is tested), never depend on seed rows.
* **Dev/test** keep the demo data and never run the prod-cleanup folder.
* Seed files were moved, not edited: contents, version numbers and checksums are unchanged.
* New seed data goes into `db/seed` (and must not be needed by any later migration); new
  prod-only repairs go into `db/prod-cleanup`. Version numbers are shared across all locations, so
  pick the next free one.

`DataMigrationsTest` (H2) migrates a fresh database with the production layout and with the dev
layout, checks the schema validates (`ProductionLayoutContextTest`), and runs the V30 cleanup on a
database that had the seed rows. The same scenarios run against PostgreSQL in
`DataMigrationsPostgresTest` (`./gradlew testcontainersTest`: a throw-away container, or the server named
by `TASKFLOW_TEST_POSTGRES_URL`).

## Numbering conventions

* Versions are plain integers, strictly increasing, no reuse.
* **There is intentionally no `V16`.** A V16 public-id repair was written but never discovered by
  Flyway, so it was never applied; its replacement was shipped forward as
  `V23__ReseedPublicIds.java` (see that class's Javadoc). The gap is deliberate. Do **not**
  add a `V16`: databases that already applied V17 and later would fail Flyway validation
  (`Detected resolved migration not applied to database`) or require `outOfOrder`.
* Use a Java migration (`BaseJavaMigration`) when SQL differs between PostgreSQL and H2: branch on
  `connection.getMetaData().getDatabaseProductName()` (see V21, V25, V32, V35). PostgreSQL gets the real
  partial / expression index; H2 gets a generated-column emulation.
* PostgreSQL extensions: V35 needs `btree_gist` (a trusted extension since PostgreSQL 13, so the
  database owner can create it; otherwise a DBA runs `CREATE EXTENSION btree_gist;` once). The
  official `postgres` images used by Compose, CI and Testcontainers ship it. The migration fails
  loudly if it cannot be created.
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
| V35 (Java) | `appointments.booking_end_time` (backfill start + service duration, 60 min default, clamped 23:59:59; NOT NULL + CHECK), deny overlapping active rows (APPROVED first, then lowest id; ids logged, DECLINED notice for upcoming ones); PostgreSQL: `btree_gist` + `appointments_no_overlap` EXCLUDE constraint |
| V36 (Java) | PostgreSQL only: `pg_trgm` + GIN trigram indexes on `lower()` of customer name, e-mail and phone for the admin `LIKE '%term%'` search (an optimisation: skipped with a warning if the extension cannot be created; H2 has no expression indexes) |
