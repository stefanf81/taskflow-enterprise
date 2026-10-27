# ADR-022: Enforced Module Boundaries (Spring Modulith)

**Status:** Accepted

## Context

The backend is a modular monolith (`appointment`, `auth`, `catalog`, `notification`, `review`, shared `core`) and `ModularityTest` ran `ApplicationModules.verify()`. In practice it enforced almost nothing:

1. **Everything was public.** 36 of the 37 top-level types in `appointment` and 17 of 22 in `auth` were `public`. Spring Modulith treats a module's public root-package types as its API, so the whole package was the API; only the repositories under `internal/` were hidden.
2. **No declared dependencies.** No `package-info.java`, so any module could start depending on any other without a test failing.
3. **The JPA entity crossed modules.** `notification` received the `Appointment` entity in events and from `AppointmentService`, and mutated it (`setReminderSent`) through `AppointmentService.save`. `review` held an `@OneToOne Appointment`.
4. **No module-level tests.** Nothing booted a module on its own.

Reference points: Spring Modulith's own example application makes the module services package-private and exposes only events and a few types; its documentation describes `@ApplicationModule(allowedDependencies = …)` and `@ApplicationModuleTest` for exactly this.

## Decision

1. **Declare the graph.** Every module has a `package-info.java` with `@ApplicationModule(allowedDependencies = …)`: `appointment → catalog, core`; `notification → appointment, core`; `review → appointment, core`; `auth → core`; `catalog → core`; `core → none`. `@Modulithic(sharedModules = "core")` on the application class makes `core` part of every module test. The annotations come from `spring-modulith-api` as `compileOnly`, so nothing is added to the boot JAR.
2. **Hide what no other module uses.** Controllers, `*ServiceImpl`, schedulers, listeners, configuration and request/response records that only their own module touches are package-private. A type stays public when another package uses it: an interface or record in a public service signature, anything a repository in `<module>/internal` needs, or something the cross-cutting tests under `benchmark/`, `core/` and `features/` construct.
3. **Keep the entity internal.** `Appointment` lives in `appointment.internal`, so `verify()` rejects any other module that references it (checked with a probe class in `notification`).
4. **Hand out snapshots, not entities.** `AppointmentDetails` is an immutable record. `AppointmentStatusChangedEvent` and `AppointmentCancelledEvent` carry it, and `AppointmentService` exposes `findDetailsByPublicId` and `claimReminder` instead of returning or saving the `Appointment` entity. `claimReminder` locks the row, re-checks status/date/`reminderSent`, flips the flag and returns the snapshot. It is `Propagation.MANDATORY`: without the caller's transaction it throws instead of committing the flag on its own, so the flag and the outbox row always commit together.
5. **Reference across modules by id.** `Review.appointmentId` replaces the `@OneToOne Appointment`. Ratings no longer join the appointment entity in JPQL (a dependency `verify()` cannot see): the review module reads its `(appointmentId, rating)` pairs, asks `AppointmentService.findApprovedBarberNames(ids)` (one `IN` query per 512 ids, padded by Hibernate), and averages per barber in memory. The database schema is unchanged.
6. **One test per module.** `CatalogModuleTest`, `AuthModuleTest` (standalone), `AppointmentModuleTest` (direct dependencies) and `NotificationModuleTest`, `ReviewModuleTest` (all dependencies) boot only their module. They create their own fixtures with unique names because the in-memory H2 database is shared and other test classes wipe the seeds.
7. **Nested module for the admin event stream.** `appointment.stream` (`AppointmentEventStreamService`, its listener and `AppointmentAdminEvent`) is a nested `@ApplicationModule` that depends on `core` only; `appointment` lists it in its `allowedDependencies`. It was the one cluster with no way back into the parent: the parent publishes its event and subscribes controllers, nothing else.
8. **Drop the overlapping ArchUnit rules.** The cycle rule and the "core depends on no feature module" rule are subsumed by `verify()` and `allowedDependencies = {}`. `ArchitectureTest` keeps the coding-standard rules Modulith does not cover.

## Consequences

### Positive
- A new cross-module import fails `ModularityTest` unless it is declared (checked by temporarily forbidding `review → appointment`: the test fails).
- Only the intended API is reachable from other modules; the compiler rejects the rest.
- `notification` and `review` can no longer change or lazy-load an appointment; the reminder claim and its race checks live with the data they protect (`AppointmentServiceImplTest`).
- The published OpenAPI document is unchanged (`npm run api:spec:check` against a running backend).

### Negative
- The ratings endpoint now loads every `(appointmentId, rating)` pair and issues one `IN` query per 512 reviews instead of a single `GROUP BY`. That is fine at a shop's review volume; if reviews grow into the hundreds of thousands, keep a per-review barber/`counts` column updated from the appointment events instead.
- Types the shared `benchmark`/`core` tests use stay public. Moving those tests into the module packages would allow hiding more.
- Five extra Spring contexts in the test run (about 15 s). They share the in-memory database, so they must not depend on seed data.
- `AppointmentService` still bundles admin, customer and cross-module operations in one interface; splitting it is a follow-up.
- **Not split yet: barber, availability, stats.** They are tangled with the rest of `appointment`: `Appointment` has a JPA association to `Barber`, `BarberServiceImpl` cancels appointments when time off is added and shares `BookingProperties`/`AvailabilityChangedEvent`/`NO_PREFERENCE_BARBER`, and `AppointmentStatsService` ↔ `BusySlotsService` ↔ `AppointmentServiceImpl` call each other. Splitting them today would only turn a cycle between classes into a cycle between modules, or force internals public. The prerequisite is inverting the time-off → cancellation call into an event the appointment side handles, and giving the barber cluster its own configuration properties.
