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

Introduce a **partial unique index** that enforces uniqueness only for active statuses, allowing `DENIED` (cancelled) slots to be re-booked. Delivered as a Java-based Flyway migration `src/main/java/db/migration/V21__fix_double_booking_index.java` (Java migration handles existing duplicate data before the index is created):

**Migration steps:**

1. Normalize `booking_time` 4-char `H:mm` → 5-char `HH:mm` via `LPAD(booking_time, 5, '0')` where `LENGTH=4` (V22 later converts the column to `TIME`, but V21 must work while it is still `VARCHAR` on a fresh database).
2. Deduplicate active rows:
   * `PENDING` rows that overlap an existing `APPROVED` on the same `(barber, date, time)` → `DENIED`.
   * Multiple `APPROVED` on the same slot → keep earliest (`id` smallest), mark rest `DENIED`.
   * Multiple `PENDING` on the same slot → keep earliest, mark rest `DENIED`.
3. Drop legacy indexes `idx_appointment_slot` and `idx_appointment_slot_active`.
4. Create the partial index:
   * **PostgreSQL:** `CREATE UNIQUE INDEX idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING','APPROVED')` — the predicate excludes `DENIED`, so cancelled slots are not indexed and can be re-booked.
   * **H2 (test):** PostgreSQL partial-index syntax is not reliably available, so a **generated marker column** emulates it:
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
- **H2/PostgreSQL parity:** Generated-column trick gives H2 the same partial-index semantics as PostgreSQL without branching application code.

### Negative
- **Hibernate session artifact under contention:** Under 50-way burst, some losing threads hit `AssertionFailure` / `null identifier` after the `23505` exception leaves the Hibernate session in a bad state before rollback — counted as `collision` (same root cause). All 50 threads are blocked except the single winner; zero silent double-bookings, but log noise may need filtering.
- **Flyway Java migration complexity:** `V21__fix_double_booking_index` is imperative Java, not declarative SQL — it must normalize times, deduplicate, and handle both PostgreSQL and H2 dialects. Future migrations that touch `appointments` must be aware of `active_slot_marker` (H2) and the partial predicate (PostgreSQL).
- **Cache staleness window:** `busySlots` is cached 2m; a stale cache could show a just-booked slot as free for up to 2m, but the partial index still blocks the insert — the UX shows a transient "slot free" that fails on submit with a retryable "just booked" error rather than a silent double-booking.

## Verification

Benchmark: `src/test/java/com/example/taskflow/benchmark/SlotContentionBenchmarkTest.java` (`@Tag("benchmark")`) covers sequential double-booking, `busySlots` after `PENDING`/`DENIED`, re-book after `DENIED`, 50-way contention, and `EXPLAIN` / `INFORMATION_SCHEMA` index presence. `P1AndP2BenchmarkTest` asserts `V21__fix_double_booking_index.java` contains `WHERE status IN ('PENDING','APPROVED')` and `active_slot_marker`.

## Alternatives Considered
- **Row-level `SELECT … FOR UPDATE` on barber+date:** Serializes correctly but holds locks longer and hurts throughput (Hikari 25-pool contention). Rejected in favor of the declarative partial index.
- **Application-only busySlots check:** Cheaper but not serialization-guaranteed — TOCTOU remains. Retained only as the first (fast) guard, not the sole guard.
