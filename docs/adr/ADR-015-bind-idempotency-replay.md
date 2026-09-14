# ADR-015: Bind Idempotency-Key Replays to the Original Request

**Status:** Accepted

## Context

`POST /api/v1/appointments` is public and accepts an optional `Idempotency-Key` header. `AppointmentServiceImpl.createAppointment()` looked the key up globally and returned the stored appointment whenever any row matched:

```java
Appointment existing = appointmentRepository.findByIdempotencyKey(idempotencyKey);
if (existing != null) {
    return AppointmentResponse.fromEntity(existing); // full PII, no caller check
}
```

`AppointmentResponse` contains `customerName`, `customerEmail`, and `customerPhone`. Anyone able to supply or guess a key could read another customer's booking. The same unverified lookup existed in the `DataIntegrityViolationException` concurrency handler, and replays returned `201 Created` even though no resource was created.

## Decision

An idempotency replay is honored only when the replay request matches the original on **customer email and booking payload** (date, normalized time, service, and barber — with the `No Preference` sentinel treated as a wildcard because it resolves to a concrete barber before persisting). Otherwise the request fails with `409 Conflict` and a generic message, carrying no appointment data.

Mechanics:

* `AppointmentCreationResult(AppointmentResponse, boolean replayed)` conveys the outcome; the controller returns `200 OK` for a verified replay and `201 Created` for a new booking.
* `IdempotencyConflictException` (core) is mapped to `409` by `GlobalExceptionHandler`.
* Both the pre-check and the unique-violation catch path run the same verification, so a concurrent duplicate cannot bypass it.
* The header is bounded to its database column (`@Size(max = 100)`), returning 400 for overlong keys.

Keys remain globally unique (`appointments.idempotency_key`), so the constraint still serializes concurrent duplicates; only the response is now gated by ownership.

## Consequences

### Positive
- A leaked, logged, or guessable key no longer discloses another customer's PII; the mismatch path returns no booking body.
- Key reuse for an unrelated booking is surfaced as an explicit conflict instead of silently returning the wrong appointment.
- Replay semantics are standards-aligned: `200` replay vs `201` creation.

### Negative
- Contract change: replays previously returned `201`. No current client sends the header (web and mobile omit it), so the only consumers affected are external integrations; the OpenAPI baseline documents the new responses.
- A replayed sentinel request is treated as a barber wildcard: the same customer, date, time, and service returns the originally assigned barber. A replay of a specific-barber request with the sentinel would also match; this is intentional, low-risk (same customer/payload), and avoids persisting the original sentinel choice.

## Verification

- `AppointmentServiceImplTest`: same-payload replay returns `replayed=true` without saving; email mismatch and payload mismatch throw `IdempotencyConflictException`.
- `AppointmentControllerIntegrationTest`: replay returns 200 with the same id; different customer → 409 with no `customerEmail`; different time → 409; overlong key → 400.
- `api/openapi.json` documents `200`, `201`, `400`, `409` and the header's `maxLength: 100`.

## Alternatives Considered
- **Remove idempotency support entirely** (no client uses it): simplest, but discards a useful retry-safe booking guarantee and the schema constraint that already backs it. Rejected.
- **Return a minimal body (public id only) on replay:** limits disclosure but breaks the "same response" contract and still confirms key existence. Rejected in favor of ownership verification.
