# ADR-014: Resolve "No Preference" Bookings to a Concrete Barber

**Status:** Accepted

## Context

Both web (`frontend/src/app/app.ts`) and mobile (`mobile/src/screens/BookingScreen.tsx`) offer `No Preference (First Available)` as a barber choice. Historically `AppointmentServiceImpl.createAppointment()` persisted that sentinel string verbatim with `barber_id = NULL` and skipped schedule/time-off validation for it.

That broke the anti-double-booking guarantee established by ADR-013:

* The partial unique index is keyed on `barber_name`, so the sentinel looked like a distinct fictitious barber.
* `AppointmentRepository.findDistinctBookingTimes(barber, date, DENIED)` filters by the real barber name, so sentinel rows were invisible to per-barber availability checks.

Result: a sentinel booking at 10:00 and a specific booking for `Alex` at 10:00 could both commit, and the sentinel `busySlots` view could advertise slots that were no longer servable. `BusySlotsService` also issued 1 + 3N queries (N = barbers) when computing sentinel availability.

## Decision

Treat `No Preference (First Available)` as an **input-only sentinel**. Resolve it inside the booking transaction to a concrete catalog barber before any validation or persistence:

1. `BusySlotsService.findFirstAvailableBarber(date, time)` (uncached, because assignment must be transaction-fresh) iterates barbers in deterministic id order and returns the first who is scheduled that weekday, whose working window contains the requested time, is not on time off, and has no active booking at that slot.
2. `AppointmentServiceImpl.resolveBarber()` either resolves the sentinel or looks up the concrete name (unknown names remain a 400).
3. The resolved `Barber` entity flows through schedule validation, the in-transaction time-off recheck, the busy-slot check, `barberName`, and the `barber` FK. The sentinel is never persisted.
4. If no barber can serve the slot the request is rejected with `400 "No barber is available…"` instead of persisting an unprotected row.
5. Flyway `V26__assign_sentinel_appointments.java` repairs legacy rows: each active sentinel row (in booking order) is assigned the first eligible barber; rows no barber can serve are marked `DENIED` — the same conflict semantics V25 uses for duplicates.

The resolver reuses the same eligibility rules as the sentinel `busySlots` aggregation so the calendar and the assignment cannot disagree.

## Consequences

### Positive
- The ADR-013 partial unique index now protects every booking, including sentinel-originated ones; the specific-barber double-booking hole is closed.
- `busySlots` and persisted assignments share one source of truth; `barber_id` is always populated for active rows.
- The receipt/confirmation surfaces the assigned barber (web renders the create response, mobile stores it in `receiptAppointment`), so "First Available" becomes a transparent auto-assignment.

### Negative
- A concurrent pair of sentinel bookings can resolve to the same free barber; the loser fails with the existing retryable "slot was just booked" 400 instead of transparently taking the next free barber. Deliberate: retrying inside the same transaction after a constraint hit is unsafe (Hibernate persistence context), and a bounded retry would need a `REQUIRES_NEW` helper.
- The resolver is uncached and adds a small per-booking query cost for sentinel requests.

## Verification

- `AppointmentServiceImplTest`: sentinel resolves to a working barber, rejects when none is available, never persists the sentinel.
- `AppointmentControllerIntegrationTest`: sentinel booking stores a non-null barber FK; a subsequent specific booking for the assigned barber at the same slot returns 400; a Sunday request returns 400.
- `AppointmentControllerTestcontainersTest` (PostgreSQL): resolves under the real partial index and rejects the follow-up specific booking.
- `V26AssignSentinelAppointmentsTest`: distinct assignment, overflow denial, time-off/closed-day denial, booked-barber skip, idempotent re-run.

## Alternatives Considered
- **Capacity model** (store the sentinel plus a slot capacity and allow as many sentinel bookings as free barbers): closer to the literal "no preference" intent but requires a new capacity table/exclusion constraint, cannot be expressed by the existing unique index, and would still need per-barber reconciliation later. Rejected as disproportionate for this deployment.
- **Leave null barber and include sentinel rows in per-barber availability:** still lets two requests race past a non-atomic check and requires every reader to special-case the sentinel. Rejected.
