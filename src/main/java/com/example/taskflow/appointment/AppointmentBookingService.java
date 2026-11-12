package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.CreationRequestFingerprint;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;

import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.LogSanitizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Guest booking: creates appointments and answers the busy-slot lookups of the booking form.
 *
 * <ul>
 *   <li><b>Idempotency replay (ADR-015).</b> An {@code Idempotency-Key} replay is answered with the
 *       existing booking only for the same customer and payload, otherwise 409. The check runs
 *       before the attempt, after a unique-index collision and after a validation rejection.</li>
 *   <li><b>Per-email lock.</b> The per-address cap is a read-check-insert, so attempts for the same
 *       address are serialised (per JVM) until the attempt's transaction has committed.</li>
 *   <li><b>Deadlock retry.</b> A PostgreSQL deadlock victim (40P01) is retried once.</li>
 *   <li><b>No Preference (ADR-014).</b> {@link #NO_PREFERENCE_BARBER} is resolved to a concrete,
 *       available barber inside the booking transaction; the sentinel is never persisted.</li>
 * </ul>
 */
@Service
class AppointmentBookingService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentBookingService.class);

    /**
     * Sentinel barber name used by the web/mobile booking UI to mean "assign me
     * to any available barber". It is NOT a catalog row, so schedule validation
     * and FK resolution are intentionally skipped for this exact string. Every
     * other barber name must resolve to a real {@link Barber} catalog entry or
     * the booking is rejected with a 400.
     */
    static final String NO_PREFERENCE_BARBER = "No Preference (First Available)";

    private final AppointmentRepository appointmentRepository;
    private final AppointmentChangePublisher changes;
    private final BusySlotsService busySlotsService;
    private final BarberRepository barberRepository;
    private final CatalogService catalogService;
    private final Clock clock;
    private final BookingProperties bookingProperties;
    private final TransactionTemplate createTransactionTemplate;
    private final TransactionTemplate idempotencyLookupTemplate;

    /** Lock stripes for the per-email booking cap (bounded memory, independent addresses rarely share). */
    private final ReentrantLock[] emailLocks = newEmailLocks(64);

    AppointmentBookingService(AppointmentRepository appointmentRepository,
                              AppointmentChangePublisher changes,
                              BusySlotsService busySlotsService,
                              BarberRepository barberRepository,
                              CatalogService catalogService,
                              Clock clock,
                              BookingProperties bookingProperties,
                              PlatformTransactionManager transactionManager) {
        this.appointmentRepository = appointmentRepository;
        this.changes = changes;
        this.busySlotsService = busySlotsService;
        this.barberRepository = barberRepository;
        this.catalogService = catalogService;
        this.clock = clock;
        this.bookingProperties = bookingProperties;
        this.createTransactionTemplate = new TransactionTemplate(transactionManager);
        this.createTransactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.idempotencyLookupTemplate = new TransactionTemplate(transactionManager);
        this.idempotencyLookupTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.idempotencyLookupTemplate.setReadOnly(true);
    }

    public AppointmentCreationResult createAppointment(AppointmentCreateRequest request, String idempotencyKey) {
        String trimmedKey = normalizeIdempotencyKey(idempotencyKey);

        if (trimmedKey != null) {
            Appointment existing = lookupByIdempotencyKey(trimmedKey);
            if (existing != null) {
                return replayOrConflict(existing, request, trimmedKey);
            }
        }

        // A4: idempotency is enforced by a unique constraint on idempotency_key.
        // The check-then-save above is non-atomic, so concurrent duplicates can
        // race past the check. The attempt runs in its own transaction so that a
        // constraint violation is fully rolled back before we query for the
        // winner: on PostgreSQL the losing transaction is aborted at the first
        // error, and re-querying inside it (the previous behaviour) failed with
        // "session flushed after exception" / "current transaction is aborted".
        // The per-email cap is a read-check-insert: serialise attempts for the same address (until
        // the attempt's transaction has committed) so concurrent requests cannot all read the same
        // count and overshoot it. Per JVM, matching the documented single-replica deployment.
        Lock emailLock = emailLockFor(request.customerEmail());
        emailLock.lock();
        try {
            return createAppointmentRetryingDeadlock(request, trimmedKey);
        } catch (IllegalArgumentException ex) {
            // A same-key request can commit between the pre-check above and this
            // attempt's busy-slot read. The after-commit eviction then makes the
            // reload see the winner's slot as busy, so the attempt rejects the
            // slot before it ever reaches the unique index. Re-check the key so
            // that loser gets a verified replay (or 409) instead of a 400.
            if (trimmedKey != null) {
                Appointment existing = lookupByIdempotencyKey(trimmedKey);
                if (existing != null) {
                    return replayOrConflict(existing, request, trimmedKey);
                }
            }
            throw ex;
        } catch (DataIntegrityViolationException ex) {
            // H1: Inspect the root cause to distinguish constraint violations.
            // Previously, ANY DataIntegrityViolationException was treated as either
            // an idempotency-key collision or a slot collision. A different constraint
            // (FK, NOT NULL, CHECK) would incorrectly return "slot was just booked".
            //
            // Next steps:
            //   1. Try idempotency-key lookup in a fresh transaction — verified
            //      replay or 409 conflict.
            //   2. If SQLState = 23505 (unique_violation) or 23P01 (exclusion_violation,
            //      PostgreSQL only), treat as slot collision.
            //   3. Otherwise, surface a generic "data conflict" error.
            if (trimmedKey != null) {
                Appointment existing = lookupByIdempotencyKey(trimmedKey);
                if (existing != null) {
                    return replayOrConflict(existing, request, trimmedKey);
                }
            }
            if (SqlStates.isSlotConstraintViolation(ex)) {
                // Slot was booked between our busy-slots check and save (TOCTOU).
                // The partial unique index idx_appointment_slot_active (same start) or, on
                // PostgreSQL, the appointments_no_overlap exclusion constraint (overlapping
                // interval with a different start) caught it.
                logger.warn("Slot collision for {} at {} on {} — request raced with another booking.",
                        LogSanitizer.stripNewlines(request.barberName()),
                        LogSanitizer.stripNewlines(request.bookingTime()),
                        request.bookingDate());
                throw new IllegalArgumentException(
                        "This time slot was just booked by someone else. Please select a different time.");
            }
            // Unknown constraint violation (FK, NOT NULL, CHECK, etc.)
            logger.error("Unexpected data integrity violation during appointment creation (root: {})",
                    LogSanitizer.safeMessage(ex), ex);
            throw new IllegalArgumentException(
                    "Unable to process the booking due to a data conflict. Please try again.");
        } finally {
            emailLock.unlock();
        }
    }

    private static ReentrantLock[] newEmailLocks(int stripes) {
        ReentrantLock[] locks = new ReentrantLock[stripes];
        for (int i = 0; i < stripes; i++) {
            locks[i] = new ReentrantLock();
        }
        return locks;
    }

    private Lock emailLockFor(String email) {
        String key = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        return emailLocks[Math.floorMod(key.hashCode(), emailLocks.length)];
    }

    /**
     * Two concurrent overlapping inserts with different start times can deadlock on PostgreSQL:
     * each checks the {@code appointments_no_overlap} exclusion constraint, finds the other's
     * uncommitted row and waits for it, and the server aborts one with 40P01. The victim's
     * transaction is rolled back, so the attempt is run once more: by then the survivor has
     * committed (the in-transaction check rejects the slot) or is still running (the insert
     * waits for it and fails with 23P01). Either way the caller gets the slot-collision 400
     * instead of a 503. Lock timeouts and other locking failures are not retried.
     */
    private AppointmentCreationResult createAppointmentRetryingDeadlock(
            AppointmentCreateRequest request, String trimmedKey) {
        try {
            return createAppointmentInTransaction(request, trimmedKey);
        } catch (PessimisticLockingFailureException ex) {
            if (!SqlStates.isDeadlock(ex)) {
                throw ex;
            }
            logger.info("Booking attempt for {} at {} on {} was a deadlock victim; retrying once.",
                    LogSanitizer.stripNewlines(request.barberName()),
                    LogSanitizer.stripNewlines(request.bookingTime()),
                    request.bookingDate());
            return createAppointmentInTransaction(request, trimmedKey);
        }
    }

    /**
     * Runs one booking attempt in its own transaction. Kept separate from the
     * idempotency resolution above so a failed attempt can be rolled back without
     * poisoning the transaction used to detect a concurrent replay.
     */
    private AppointmentCreationResult createAppointmentInTransaction(
            AppointmentCreateRequest request, String trimmedKey) {
        return createTransactionTemplate.execute(status -> {
            LocalDateTime now = LocalDateTime.now(clock);
            LocalDate today = now.toLocalDate();
            LocalDate bookingDate = request.bookingDate();

            // BKG-1: a booking must start on the shared hourly grid. Every other layer
            // (busy-slot list, unique index) is keyed on the exact start time, so an
            // off-grid start such as 10:30 would slip past them.
            if (!BusySlotsService.isGridSlot(request.bookingTime())) {
                throw new IllegalArgumentException("Booking time must be one of the available time slots: "
                        + String.join(", ", BusySlotsService.ALL_SLOTS) + ".");
            }
            LocalTime bookingTime = LocalTime.parse(request.bookingTime().trim());

            // BKG-2: not in the past (shop time zone), not too far ahead.
            if (!LocalDateTime.of(bookingDate, bookingTime).isAfter(now)) {
                throw new IllegalArgumentException("The appointment must be in the future. Please choose a later date or time.");
            }
            if (bookingDate.isAfter(today.plusDays(bookingProperties.maxAdvanceDays()))) {
                throw new IllegalArgumentException("Appointments can be booked at most "
                        + bookingProperties.maxAdvanceDays() + " days in advance.");
            }

            // A1: resolve the catalog service first - its duration drives every availability rule.
            ServiceItem service = catalogService.findServiceByName(request.serviceType())
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Unknown service: '" + LogSanitizer.stripNewlines(request.serviceType())
                                    + "'. Please select a service from the catalog."));
            int durationMinutes = service.getDurationMinutes() != null && service.getDurationMinutes() > 0
                    ? service.getDurationMinutes() : BusySlotsService.DEFAULT_DURATION_MINUTES;

            // Roster/time-off writes take the barber's exclusive lock. Take our shared lock
            // before ANY schedule inputs are loaded (including No Preference resolution).
            List<Barber> lockedBarbers = NO_PREFERENCE_BARBER.equals(request.barberName())
                    ? barberRepository.findAllForBooking()
                    : null;

            // H2: "No Preference (First Available)" is an input-only sentinel. Resolve
            // it to a concrete, available barber BEFORE persisting so the partial
            // unique slot index and the per-barber availability queries both see the
            // booking. The resolver applies the same rules as a named barber.
            ResolvedBarber resolved = resolveBarber(request, durationMinutes, lockedBarbers);
            Barber resolvedBarber = resolved.barber();
            String effectiveBarberName = resolvedBarber.getName();

            // Authoritative, in-transaction availability check (time off, schedule, service
            // length vs. closing time, overlap with PENDING/APPROVED bookings). It reads the
            // database rather than the 2-minute busy-slots cache. A truly concurrent insert
            // racing this transaction is caught by the partial unique slot index for the
            // same start time and, on PostgreSQL, by the appointments_no_overlap exclusion
            // constraint for overlapping intervals with different start times (services
            // longer than the grid step). H2 has no exclusion constraints; there this check
            // is the only guard against such overlaps.
            // A "No Preference" barber was picked by these same rules in this transaction, so the
            // check is not repeated (three more queries); a second read could not close the race
            // the constraints above guard anyway.
            if (!resolved.availabilityChecked()) {
                busySlotsService.findConflict(resolvedBarber, bookingDate, bookingTime, durationMinutes, null)
                        .ifPresent(message -> {
                            throw new IllegalArgumentException(message);
                        });
            }

            // BKG-2: bound the number of upcoming bookings one e-mail address can hold.
            long upcoming = appointmentRepository.countUpcoming(request.customerEmail().trim(), today,
                    now.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")));
            if (upcoming >= bookingProperties.maxActivePerEmail()) {
                throw new IllegalArgumentException("This email address already has "
                        + bookingProperties.maxActivePerEmail() + " upcoming appointments, which is the maximum. "
                        + "Please cancel one before booking another.");
            }

            Appointment item = new Appointment();
            item.setIdempotencyKey(trimmedKey);
            item.setCustomerName(request.customerName());
            item.setCustomerEmail(request.customerEmail().trim());
            item.setCustomerPhone(request.customerPhone());
            // A1: keep denormalized name cache in sync with the FK (renders instantly
            // in the UI without an extra join) AND wire the real catalog FKs.
            item.setBarberName(effectiveBarberName);
            item.setBarber(resolvedBarber);
            item.setServiceType(request.serviceType());
            item.setService(service);
            // Freeze the price: later catalog price edits must not rewrite revenue history.
            item.setPriceAtBooking(service.getPrice());
            // Store exactly the interval the rules above validated; the exclusion constraint keys on it.
            item.setBookingSlot(bookingDate, request.bookingTime().trim(),
                    Appointment.endTimeOf(bookingTime, durationMinutes));
            item.setStatus(AppointmentStatus.PENDING);

            Appointment savedItem = appointmentRepository.save(item);
            changes.availabilityChanged(savedItem);
            changes.adminEvent(AppointmentAdminEvent.Type.CREATED, savedItem.getId());

            changes.tagSpan(
                // The customer's name is deliberately not a span attribute: traces are
                // exported to a separate backend with different access and retention.
                "appointment.id", String.valueOf(savedItem.getId()),
                "appointment.status", savedItem.getStatus()
            );

            return AppointmentCreationResult.created(AppointmentResponse.fromEntity(savedItem));
        });
    }

    /**
     * Blank/whitespace keys are treated as absent. Persisting the empty string
     * instead would occupy the unique {@code idempotency_key} index and make
     * every subsequent blank-key booking fail as a false slot collision.
     */
    private static String normalizeIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null) {
            return null;
        }
        String trimmed = idempotencyKey.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Looks up an existing booking in its own short read-only transaction. */
    private Appointment lookupByIdempotencyKey(String key) {
        return idempotencyLookupTemplate.execute(status -> appointmentRepository.findByIdempotencyKey(key));
    }

    /**
     * H1: An {@code Idempotency-Key} replay is only honored for the same customer
     * and booking payload. Any other reuse is a 409 conflict — never a replay of
     * another customer's appointment (which would leak name, email and phone).
     */
    private AppointmentCreationResult replayOrConflict(
            Appointment existing, AppointmentCreateRequest request, String idempotencyKey) {
        if (!isSameReplayRequest(existing, request)) {
            logger.warn("Idempotency-Key replay rejected: payload mismatch (key hash {}).",
                    Integer.toHexString(idempotencyKey.hashCode()));
            throw new IdempotencyConflictException(
                    "The Idempotency-Key was already used for a different request. Please retry with a new key.");
        }
        // A replay of a booking that was cancelled (or declined) in the meantime answers with
        // that row - including its CANCELLED status - rather than silently re-booking the slot.
        logger.info("Idempotency-Key replay matched appointment id {}.", existing.getId());
        return AppointmentCreationResult.replayed(AppointmentResponse.fromEntity(existing));
    }

    /**
     * Compares the complete canonical creation payload to its immutable fingerprint. Moving the
     * appointment must never bind the key to its new slot. The No Preference input retains the
     * historical wildcard behavior: it is compared using the originally assigned real barber
     * (rescheduling never changes barber or service).
     */
    private static boolean isSameReplayRequest(Appointment existing, AppointmentCreateRequest request) {
        if (existing == null || request == null) {
            return false;
        }
        String fingerprint = existing.getCreationRequestFingerprint();
        // Unsaved test fixtures/legacy in-memory objects have no fingerprint yet; real rows are
        // backfilled by V41. Never derive a persisted row's binding after a move.
        if (fingerprint == null) {
            fingerprint = CreationRequestFingerprint.of(existing);
        }
        String barber = NO_PREFERENCE_BARBER.equals(request.barberName())
                ? existing.getBarberName() : request.barberName();
        return fingerprint.equals(CreationRequestFingerprint.of(request, barber));
    }

    /**
     * The barber a booking is placed with.
     *
     * @param availabilityChecked whether the booking rules already accepted this barber for the
     *                            requested slot (the "No Preference" resolution evaluates them)
     */
    private record ResolvedBarber(Barber barber, boolean availabilityChecked) {
    }

    /**
     * Resolves the requested barber name to a catalog entity. The
     * {@link #NO_PREFERENCE_BARBER} sentinel is resolved to the first barber who
     * can take the booking (schedule, time off, service length, overlap); unknown
     * concrete names are rejected with a 400.
     */
    private ResolvedBarber resolveBarber(AppointmentCreateRequest request, int durationMinutes,
                                         List<Barber> lockedBarbers) {
        if (NO_PREFERENCE_BARBER.equals(request.barberName())) {
            return busySlotsService.findFirstAvailableBarber(
                            lockedBarbers, request.bookingDate(), request.bookingTime(), durationMinutes)
                    .map(barber -> new ResolvedBarber(barber, true))
                    .orElseThrow(() -> new IllegalArgumentException(
                            "No barber is available for the selected time. Please choose another time or barber."));
        }
        return barberRepository.findByNameForBooking(request.barberName())
                .map(barber -> new ResolvedBarber(barber, false))
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown barber: '" + LogSanitizer.stripNewlines(request.barberName())
                                + "'. Please select a barber from the list."));
    }

    @Transactional(readOnly = true)
    public List<String> getBusySlots(String barberName, String bookingDate) {
        List<String> unbookable = busyOutsideBookingWindow(barberName, bookingDate);
        return unbookable != null ? unbookable : busySlotsService.getBusySlots(barberName, bookingDate);
    }

    /** Busy slots for booking {@code serviceType} (null/blank = ignore the service's length). */
    @Transactional(readOnly = true)
    public List<String> getBusySlots(String barberName, String bookingDate, String serviceType) {
        List<String> unbookable = busyOutsideBookingWindow(barberName, bookingDate);
        if (unbookable != null) {
            return unbookable;
        }
        if (serviceType == null || serviceType.isBlank()) {
            return busySlotsService.getBusySlots(barberName, bookingDate);
        }
        int duration = bookableServiceDuration(serviceType.trim());
        // Services that fit in one grid step get the same answer from the cached path; only
        // longer ones need the length-aware computation (cached per duration).
        return duration > BusySlotsService.DEFAULT_DURATION_MINUTES
                ? busySlotsService.getBusySlots(barberName, bookingDate, duration)
                : busySlotsService.getBusySlots(barberName, bookingDate);
    }

    /**
     * Duration of an active catalog service, read from the cached catalog list (the same active
     * services {@code findServiceByName} returns). A database lookup here ran on every busy-slots
     * request, so even a warm cache could not keep that public endpoint off the database.
     */
    private int bookableServiceDuration(String serviceName) {
        Integer minutes = catalogService.getAllServices().stream()
                .filter(service -> service.name().equals(serviceName))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown service: '" + LogSanitizer.stripNewlines(serviceName)
                                + "'. Please select a service from the catalog."))
                .durationMinutes();
        return minutes != null && minutes > 0 ? minutes : BusySlotsService.DEFAULT_DURATION_MINUTES;
    }

    /**
     * Every slot of a date nobody can book (before today in shop time, or beyond
     * {@code max-advance-days}), or {@code null} for a bookable or malformed date (the latter is
     * reported by {@link BusySlotsService}). Answered without the per-date queries or a cache entry:
     * any date of the years 0001-9999 used to be computed and cached, and a past date reported every
     * slot as free. An unknown barber is still a 400.
     */
    private List<String> busyOutsideBookingWindow(String barberName, String bookingDate) {
        LocalDate date;
        try {
            date = LocalDate.parse(bookingDate == null ? "" : bookingDate.trim());
        } catch (DateTimeParseException e) {
            return null;
        }
        LocalDate today = LocalDate.now(clock);
        if (!date.isBefore(today) && !date.isAfter(today.plusDays(bookingProperties.maxAdvanceDays()))) {
            return null;
        }
        if (!NO_PREFERENCE_BARBER.equals(barberName) && barberRepository.findByName(barberName).isEmpty()) {
            throw BusySlotsService.unknownBarber(barberName);
        }
        return BusySlotsService.ALL_SLOTS;
    }
}
