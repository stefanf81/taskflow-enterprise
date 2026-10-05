# ADR-013: Partial Unique Slot Index (Anti Double-Booking)

**Status:** Accepted

## Context

`AppointmentServiceImpl.createAppointment()` (BENCHMARKS.md §41) performed:

1. `BusySlotsService.getBusySlots(barber, date)` — reads `findDistinctBookingTimes(barber, date, DENIED)` (43 µs, `@Cacheable("busySlots", sync=true)` 2m) and checks the requested `bookingTime` against the returned list.
2. `appointmentRepository.save()` — inserts `status=PENDING`.

The two steps are non-atomic (TOCTOU). Two concurrent requests with different `Idempotency-Key` values could both pass the busySlots check before either committed, then both insert — double-booking the same `(barber_name, booking_date, booking_time)`.

The original schema `V1__init_schema.sql` created:

```sql
CREATE UNIQUE INDEX idx_appointment_slot
  ON appointments(barber_name, booking_date, booking_time, status)
```

Because `status` was part of the unique key, `PENDING` and `APPROVED` on the same slot were considered **distinct** and the index did not block double-booking. The `DataIntegrityViolationException` catch in `AppointmentServiceImpl` only handled idempotency-key collisions.

`BusySlotsService` caching (TTL 2m) further widens the window: a stale cache could miss a just-inserted slot.

## Decision

Introduce a **partial unique index** that enforces uniqueness only for active statuses, allowing `DENIED` (cancelled) slots to be re-booked. Delivered across three migrations, not one:

**Migration steps:**

1. `src/main/java/db/migration/V21__fix_double_booking_index.java` — the initial fix:
   * Denies any `PENDING` row that overlaps an existing `APPROVED` on the same `(barber, date, time)`.
   * Drops the legacy `idx_appointment_slot` index.
   * Creates `idx_appointment_slot_active`:
     * **PostgreSQL:** `CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING','APPROVED')` — the predicate excludes `DENIED`, so cancelled slots are not indexed and can be re-booked.
     * **H2 (test):** PostgreSQL partial-index syntax is not reliably available, so V21's H2 fallback is a plain `CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time, status)` — weaker than the Postgres partial index, since it doesn't yet dedupe two `PENDING` or two `APPROVED` rows on the same slot.
2. `src/main/resources/db/migration/V22__convert_booking_time_to_time.sql` — normalizes `booking_time` 4-char `H:mm` → 5-char `HH:mm` via `LPAD(booking_time, 5, '0')` where `LENGTH=4`, then converts the column to `TIME`. Independent of the index work above.
3. `src/main/java/db/migration/V25__converge_appointment_slot_index.java` — converges both database paths onto the same semantics:
   * Full dedup: denies `PENDING` rows conflicting with `APPROVED`, then denies duplicate `PENDING` keeping the earliest (`id` smallest), then denies duplicate `APPROVED` keeping the earliest.
   * Drops and recreates `idx_appointment_slot_active`. **PostgreSQL** keeps the same partial index. **H2** is upgraded with a **generated marker column** that emulates the partial index:
     ```sql
     ALTER TABLE appointments ADD COLUMN IF NOT EXISTS active_slot_marker INTEGER
       AS (CASE WHEN status IN ('PENDING','APPROVED') THEN 1 ELSE NULL END);
     CREATE UNIQUE INDEX idx_appointment_slot_active
       ON appointments(barber_name, booking_date, booking_time, active_slot_marker);
     ```
     For `DENIED` rows the marker is `NULL`; SQL `NULL <> NULL` semantics mean `UNIQUE(barber, date, time, NULL)` never collides — multiple `DENIED` rows on the same slot coexist. The column is `GENERATED`, so `status` changes (e.g., `PENDING→DENIED` on cancel) automatically update the marker.

**Application second guard:** `AppointmentServiceImpl.java:230` catches `DataIntegrityViolationException` with SQL state `23505` (`unique_violation`) and maps it to `IllegalArgumentException("Slot already booked … just booked")`. The `BusySlotsService` 43 µs cached check remains the cheap first guard; the partial index is the serialization-guaranteed second guard.

`BusySlotsService.getBusySlots()` (`@Cacheable("busySlots", key="#barberName+'-'+#bookingDate", sync=true)` TTL 2m, `BusySlotsService.java:53`) reads `appointmentRepository.findDistinctBookingTimes(barber, date, DENIED)` — only active statuses are returned.

## Consequences

### Positive
- **Double-booking impossible:** Even with TOCTOU interleaving, the database serializes concurrent inserts on the same active slot. Benchmark `SlotContentionBenchmarkTest` (BENCHMARKS.md §41, H2, 1 barber + 7 schedules + 1 service, date `2026-06-15` slot `10:00`): sequential double-booking blocked in **2347 µs**; **50-way concurrent race → exactly 1 success / 49 blocked** (**808 bookings/sec** serialized wall throughput); `active rows for slot == 1` invariant verified.
- **`DENIED` slots stay re-bookable:** Because `DENIED` is excluded from the predicate/marker, cancelling a booking removes it from the unique constraint and from `busySlots` — verified: `DENIED` → `busySlots` no longer contains slot → new `PENDING` inserts successfully.
- **Read path stays fast:** `busySlots` remains **43 µs** avg (5000 iters) and `EXPLAIN` shows `idx_appointment_slot_active` usage; old `idx_appointment_slot` is absent (`INFORMATION_SCHEMA` verified).
- **H2/PostgreSQL parity:** V25's generated-column trick gives H2 the same partial-index semantics as PostgreSQL without branching application code.

### Negative
- **Hibernate session artifact under contention:** Under 50-way burst, some losing threads hit `AssertionFailure` / `null identifier` after the `23505` exception leaves the Hibernate session in a bad state before rollback — counted as `collision` (same root cause). All 50 threads are blocked except the single winner; zero silent double-bookings, but log noise may need filtering.
- **Flyway Java migration complexity:** `V21__fix_double_booking_index` and `V25__converge_appointment_slot_index` are imperative Java, not declarative SQL — together they normalize times (via V22's SQL migration), deduplicate, and handle both PostgreSQL and H2 dialects. Future migrations that touch `appointments` must be aware of `active_slot_marker` (H2) and the partial predicate (PostgreSQL).
- **Cache staleness window:** `busySlots` is cached 2m; a stale cache could show a just-booked slot as free for up to 2m, but the partial index still blocks the insert — the UX shows a transient "slot free" that fails on submit with a retryable "just booked" error rather than a silent double-booking.

## Verification

Benchmark: `src/test/java/com/example/taskflow/benchmark/SlotContentionBenchmarkTest.java` (`@Tag("benchmark")`) covers sequential double-booking, `busySlots` after `PENDING`/`DENIED`, re-book after `DENIED`, 50-way contention, and verifies at runtime (via `EXPLAIN` and `INFORMATION_SCHEMA.INDEX_COLUMNS` queries against H2) that `idx_appointment_slot_active` exists and the old `idx_appointment_slot` does not.

## Alternatives Considered
- **Row-level `SELECT … FOR UPDATE` on barber+date:** Serializes correctly but holds locks longer and hurts throughput (Hikari 25-pool contention). Rejected in favor of the declarative partial index.
- **Application-only busySlots check:** Cheaper but not serialization-guaranteed — TOCTOU remains. Retained only as the first (fast) guard, not the sole guard.
