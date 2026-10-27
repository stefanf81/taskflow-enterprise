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
3. **Hand out snapshots, not entities.** `AppointmentDetails` is an immutable record. `AppointmentStatusChangedEvent` and `AppointmentCancelledEvent` carry it, and `AppointmentService` exposes `findDetailsByPublicId` and `claimReminder` instead of returning or saving the `Appointment` entity. `claimReminder` locks the row, re-checks status/date/`reminderSent`, flips the flag and returns the snapshot, joining the caller's transaction, so the reminder flag and the outbox row still commit together.
4. **Reference across modules by id.** `Review.appointmentId` replaces the `@OneToOne Appointment`; the per-barber rating query joins `Appointment` on `a.id = r.appointmentId`. The database schema is unchanged.
5. **One test per module.** `CatalogModuleTest`, `AuthModuleTest` (standalone), `AppointmentModuleTest` (direct dependencies) and `NotificationModuleTest`, `ReviewModuleTest` (all dependencies) boot only their module. They create their own fixtures with unique names because the in-memory H2 database is shared and other test classes wipe the seeds.
6. **Drop the overlapping ArchUnit rules.** The cycle rule and the "core depends on no feature module" rule are subsumed by `verify()` and `allowedDependencies = {}`. `ArchitectureTest` keeps the coding-standard rules Modulith does not cover.

## Consequences

### Positive
- A new cross-module import fails `ModularityTest` unless it is declared (checked by temporarily forbidding `review → appointment`: the test fails).
- Only the intended API is reachable from other modules; the compiler rejects the rest.
- `notification` and `review` can no longer change or lazy-load an appointment; the reminder claim and its race checks live with the data they protect (`AppointmentServiceImplTest`).
- The published OpenAPI document is unchanged (`npm run api:spec:check` against a running backend).

### Negative
- Types the shared `benchmark`/`core` tests use stay public. Moving those tests into the module packages would allow hiding more.
- Five extra Spring contexts in the test run (about 15 s). They share the in-memory database, so they must not depend on seed data.
- `AppointmentService` still bundles admin, customer and cross-module operations in one interface; splitting it is a follow-up.
