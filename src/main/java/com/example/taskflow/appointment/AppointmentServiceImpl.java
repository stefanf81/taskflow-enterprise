package com.example.taskflow.appointment;
import com.example.taskflow.appointment.stream.AppointmentAdminEvent;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.ConflictException;
import com.example.taskflow.core.IdempotencyConflictException;
import com.example.taskflow.core.InvalidStatusTransitionException;
import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Optional;
import io.micrometer.tracing.Tracer;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

@Service
class AppointmentServiceImpl implements AppointmentService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentServiceImpl.class);

    /**
     * Sentinel barber name used by the web/mobile booking UI to mean "assign me
     * to any available barber". It is NOT a catalog row, so schedule validation
     * and FK resolution are intentionally skipped for this exact string. Every
     * other barber name must resolve to a real {@link Barber} catalog entry or
     * the booking is rejected with a 400.
     */
    static final String NO_PREFERENCE_BARBER = "No Preference (First Available)";

    private final AppointmentRepository appointmentRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final AppointmentStatsService statsService;
    private final Tracer tracer;
    private final BusySlotsService busySlotsService;
    private final BarberRepository barberRepository;
    private final CatalogService catalogService;
    private final Clock clock;
    private final BookingProperties bookingProperties;
    private final TransactionTemplate createTransactionTemplate;
    private final TransactionTemplate idempotencyLookupTemplate;

    public AppointmentServiceImpl(AppointmentRepository appointmentRepository,
                                  ApplicationEventPublisher eventPublisher,
                                  AppointmentStatsService statsService,
                                   Tracer tracer,
                                   BusySlotsService busySlotsService,
                                   BarberRepository barberRepository,
                                   CatalogService catalogService,
                                   Clock clock,
                                   BookingProperties bookingProperties,
                                   PlatformTransactionManager transactionManager) {
        this.appointmentRepository = appointmentRepository;
        this.eventPublisher = eventPublisher;
        this.statsService = statsService;
        this.tracer = tracer;
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

    /** Safely tag the current tracing span — swallowed on failure. */
    private void tagSpan(String... keyValuePairs) {
        try {
            io.micrometer.tracing.Span span = tracer.currentSpan();
            if (span != null) {
                for (int i = 0; i < keyValuePairs.length - 1; i += 2) {
                    span.tag(keyValuePairs[i], keyValuePairs[i + 1]);
                }
            }
        } catch (Exception e) {
            logger.warn("Failed to add tracing tags: {}", LogSanitizer.stripNewlines(e.getMessage()));
        }
    }

    @Override
    @Transactional(readOnly = true)
    public AppointmentDashboardResponse getAllAppointments(String status, String searchName, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("bookingDate").ascending().and(Sort.by("bookingTime").ascending()));

        List<Specification<Appointment>> filters = new ArrayList<>();
        String statusFilter = status == null ? "" : status.trim();
        if ("OVERDUE".equalsIgnoreCase(statusFilter)) {
            // Overdue = still PENDING although the booking date has passed. The search
            // term below applies on top of it (it used to be silently ignored).
            LocalDate today = LocalDate.now(clock);
            filters.add((root, query, cb) -> cb.and(
                    cb.equal(root.get("status"), AppointmentStatus.PENDING),
                    cb.lessThan(root.<LocalDate>get("bookingDate"), today)));
        } else if (!statusFilter.isEmpty()) {
            // Unknown statuses are a 400, not a silent fall back to PENDING.
            AppointmentStatus parsed = AppointmentStatus.fromString(statusFilter);
            filters.add((root, query, cb) -> cb.equal(root.get("status"), parsed));
        }

        String term = searchName == null ? "" : searchName.trim();
        if (!term.isEmpty()) {
            filters.add(matchesSearchTerm(term));
        }

        // The unfiltered default view takes its total from the cached row count (evicted with the
        // stats on every booking) instead of counting the whole table on each request.
        Page<Appointment> itemPage = filters.isEmpty()
                ? new PageImpl<>(appointmentRepository.findPageWithoutCount(pageable).getContent(), pageable,
                        statsService.getTotalCountCached(appointmentRepository))
                : appointmentRepository.findAll(
                        (root, query, cb) -> cb.and(filters.stream()
                                .map(f -> f.toPredicate(root, query, cb))
                                .toArray(jakarta.persistence.criteria.Predicate[]::new)),
                        pageable);

        Page<AppointmentResponse> responsePage = itemPage.map(AppointmentResponse::fromEntity);

        AppointmentStats stats = statsService.getStatsCached(appointmentRepository);
        return new AppointmentDashboardResponse(responsePage, stats);
    }

    /**
     * Admin search: case-insensitive "contains" on customer name, e-mail and phone, or an
     * exact public id (a UUID, so a partial match would be meaningless).
     */
    private static Specification<Appointment> matchesSearchTerm(String term) {
        String pattern = "%" + escapeLike(term.toLowerCase(java.util.Locale.ROOT)) + "%";
        return (root, query, cb) -> cb.or(
                cb.like(cb.lower(root.<String>get("customerName")), pattern, '\\'),
                cb.like(cb.lower(root.<String>get("customerEmail")), pattern, '\\'),
                cb.like(cb.lower(root.<String>get("customerPhone")), pattern, '\\'),
                cb.equal(root.<String>get("publicId"), term));
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    @Override
    @Transactional(readOnly = true)
    public AppointmentResponse getAppointmentById(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        return AppointmentResponse.fromEntity(item);
    }

    @Override
    @Transactional(readOnly = true)
    public org.springframework.data.domain.Page<AppointmentResponse> getMyAppointments(String email, int page, int size) {
        org.springframework.data.domain.Pageable pageable = org.springframework.data.domain.PageRequest.of(
                page, size, org.springframework.data.domain.Sort.by("bookingDate").descending());
        return appointmentRepository.findByCustomerEmailIgnoreCase(email, pageable)
                .map(AppointmentResponse::fromEntity);
    }

    @Override
    @Transactional
    public void cancelMyAppointment(String publicId, String email) {
        Appointment appointment = Optional.ofNullable(appointmentRepository.findByPublicId(publicId))
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found or unauthorized."));
        if (!appointment.getCustomerEmail().equalsIgnoreCase(email)) {
            throw new ResourceNotFoundException("Appointment not found or unauthorized.");
        }
        cancelAppointment(appointment, AppointmentCancelledEvent.CancelledBy.CUSTOMER, true);
    }

    @Override
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
        java.util.concurrent.locks.Lock emailLock = emailLockFor(request.customerEmail());
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
        } catch (org.springframework.dao.DataIntegrityViolationException ex) {
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
            if (isSlotConstraintViolation(ex)) {
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

    /** Lock stripes for the per-email booking cap (bounded memory, independent addresses rarely share). */
    private final java.util.concurrent.locks.ReentrantLock[] emailLocks = newEmailLocks(64);

    private static java.util.concurrent.locks.ReentrantLock[] newEmailLocks(int stripes) {
        java.util.concurrent.locks.ReentrantLock[] locks = new java.util.concurrent.locks.ReentrantLock[stripes];
        for (int i = 0; i < stripes; i++) {
            locks[i] = new java.util.concurrent.locks.ReentrantLock();
        }
        return locks;
    }

    private java.util.concurrent.locks.Lock emailLockFor(String email) {
        String key = email == null ? "" : email.trim().toLowerCase(java.util.Locale.ROOT);
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
        } catch (org.springframework.dao.PessimisticLockingFailureException ex) {
            if (!isDeadlock(ex)) {
                throw ex;
            }
            logger.info("Booking attempt for {} at {} on {} was a deadlock victim; retrying once.",
                    LogSanitizer.stripNewlines(request.barberName()),
                    LogSanitizer.stripNewlines(request.bookingTime()),
                    request.bookingDate());
            return createAppointmentInTransaction(request, trimmedKey);
        }
    }

    /** PostgreSQL {@code deadlock_detected} (SQLSTATE 40P01) anywhere in the cause chain. */
    static boolean isDeadlock(Throwable ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof java.sql.SQLException sqlEx && "40P01".equals(sqlEx.getSQLState())) {
                return true;
            }
            cause = cause.getCause();
        }
        return false;
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

            // H2: "No Preference (First Available)" is an input-only sentinel. Resolve
            // it to a concrete, available barber BEFORE persisting so the partial
            // unique slot index and the per-barber availability queries both see the
            // booking. The resolver applies the same rules as a named barber.
            Barber resolvedBarber = resolveBarber(request, durationMinutes);
            String effectiveBarberName = resolvedBarber.getName();

            // Authoritative, in-transaction availability check (time off, schedule, service
            // length vs. closing time, overlap with PENDING/APPROVED bookings). It reads the
            // database rather than the 2-minute busy-slots cache. A truly concurrent insert
            // racing this transaction is caught by the partial unique slot index for the
            // same start time and, on PostgreSQL, by the appointments_no_overlap exclusion
            // constraint for overlapping intervals with different start times (services
            // longer than the grid step). H2 has no exclusion constraints; there this check
            // is the only guard against such overlaps.
            busySlotsService.findConflict(resolvedBarber, bookingDate, bookingTime, durationMinutes, null)
                    .ifPresent(message -> {
                        throw new IllegalArgumentException(message);
                    });

            // BKG-2: bound the number of upcoming bookings one e-mail address can hold.
            long upcoming = appointmentRepository.countUpcoming(request.customerEmail().trim(), today,
                    now.toLocalTime().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")));
            if (upcoming >= bookingProperties.maxActivePerEmail()) {
                throw new IllegalArgumentException("This email address already has "
                        + bookingProperties.maxActivePerEmail() + " upcoming appointments, which is the maximum. "
                        + "Please cancel one before booking another.");
            }

            Appointment item = new Appointment();
            item.setIdempotencyKey(trimmedKey);
            item.setCustomerName(request.customerName());
            item.setCustomerEmail(request.customerEmail());
            item.setCustomerPhone(request.customerPhone());
            // A1: keep denormalized name cache in sync with the FK (renders instantly
            // in the UI without an extra join) AND wire the real catalog FKs.
            item.setBarberName(effectiveBarberName);
            item.setBarber(resolvedBarber);
            item.setServiceType(request.serviceType());
            item.setService(service);
            // Freeze the price: later catalog price edits must not rewrite revenue history.
            item.setPriceAtBooking(service.getPrice());
            item.setBookingDate(bookingDate);
            item.setBookingTime(request.bookingTime().trim());
            // Store exactly the interval the rules above validated; the exclusion constraint keys on it.
            item.setBookingEndTime(Appointment.endTimeOf(bookingTime, durationMinutes));
            item.setStatus(AppointmentStatus.PENDING);

            Appointment savedItem = appointmentRepository.save(item);
            publishAvailabilityChange(
                    AvailabilityChangedEvent.single(savedItem.getBarberName(), savedItem.getBookingDate()));
            publishAdminEvent(AppointmentAdminEvent.Type.CREATED, savedItem.getId());

            tagSpan(
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
     * Compares a replay request against the persisted appointment. The customer
     * email, date, time and service must all match. The barber name is compared
     * exactly, except that a replayed {@link #NO_PREFERENCE_BARBER} request is a
     * wildcard: the sentinel is resolved to a concrete barber before persisting,
     * so the stored name can never equal the sentinel.
     */
    private static boolean isSameReplayRequest(Appointment existing, AppointmentCreateRequest request) {
        if (existing == null || request == null) {
            return false;
        }
        if (!sameEmail(existing.getCustomerEmail(), request.customerEmail())) {
            return false;
        }
        if (existing.getBookingDate() == null || !existing.getBookingDate().equals(request.bookingDate())) {
            return false;
        }
        if (!sameBookingTime(existing.getBookingTime(), request.bookingTime())) {
            return false;
        }
        String requestedService = request.serviceType() == null ? null : request.serviceType().trim();
        if (existing.getServiceType() == null || !existing.getServiceType().equals(requestedService)) {
            return false;
        }
        if (NO_PREFERENCE_BARBER.equals(request.barberName())) {
            return true;
        }
        String requestedBarber = request.barberName() == null ? null : request.barberName().trim();
        return existing.getBarberName() != null && existing.getBarberName().equals(requestedBarber);
    }

    private static boolean sameEmail(String left, String right) {
        return left != null && right != null && left.trim().equalsIgnoreCase(right.trim());
    }

    private static boolean sameBookingTime(String left, String right) {
        if (left == null || right == null) {
            return false;
        }
        return normalizeToHhMm(left).equals(normalizeToHhMm(right));
    }

    /** Booking times are HH:mm in the API; the TIME column can render HH:mm:ss. */
    private static String normalizeToHhMm(String time) {
        String trimmed = time.trim();
        return trimmed.length() > 5 ? trimmed.substring(0, 5) : trimmed;
    }

    /**
     * Resolves the requested barber name to a catalog entity. The
     * {@link #NO_PREFERENCE_BARBER} sentinel is resolved to the first barber who
     * can take the booking (schedule, time off, service length, overlap); unknown
     * concrete names are rejected with a 400.
     */
    private Barber resolveBarber(AppointmentCreateRequest request, int durationMinutes) {
        if (NO_PREFERENCE_BARBER.equals(request.barberName())) {
            return busySlotsService.findFirstAvailableBarber(
                            request.bookingDate(), request.bookingTime(), durationMinutes)
                    .orElseThrow(() -> new IllegalArgumentException(
                            "No barber is available for the selected time. Please choose another time or barber."));
        }
        return barberRepository.findByName(request.barberName())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown barber: '" + LogSanitizer.stripNewlines(request.barberName())
                                + "'. Please select a barber from the list."));
    }

    @Override
    @Transactional
    public AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));

        AppointmentStatus current = item.getStatusEnum();
        AppointmentStatus target = AppointmentStatus.fromString(request.status());

        // A cancelled booking is final: its slot may already belong to someone else.
        if (current == AppointmentStatus.CANCELLED) {
            throw new InvalidStatusTransitionException(current.name(), target.name());
        }
        // Same status: nothing to do - no write, no event, no e-mail to the customer.
        if (current == target) {
            return AppointmentResponse.fromEntity(item);
        }
        if (!isAllowedTransition(current, target)) {
            throw new InvalidStatusTransitionException(current.name(), target.name());
        }
        if (target == AppointmentStatus.APPROVED) {
            // PENDING -> APPROVED and DENIED -> APPROVED both put the booking on the calendar,
            // so the full availability check runs again (the slot of a DENIED booking may have
            // been re-booked, the barber may have gone on leave, the time may have passed).
            requireCanApprove(item);
        }

        item.setStatus(target);
        Appointment savedItem = appointmentRepository.save(item);
        if (target == AppointmentStatus.APPROVED) {
            flushApproval();
        }
        publishAvailabilityChange(
                AvailabilityChangedEvent.single(savedItem.getBarberName(), savedItem.getBookingDate()));

        tagSpan(
            "appointment.id", String.valueOf(savedItem.getId()),
            "appointment.status", savedItem.getStatus()
        );

        // Publish the status-change event. The notification outbox entry is written
        // by the (separate) notification slice listener so the appointment slice
        // stays decoupled from the notification slice (ArchUnit cycle rule).
        eventPublisher.publishEvent(new AppointmentStatusChangedEvent(this, AppointmentDetails.of(savedItem)));
        publishAdminEvent(AppointmentAdminEvent.Type.UPDATED, savedItem.getId());

        return AppointmentResponse.fromEntity(savedItem);
    }

    /**
     * Writes an approval immediately instead of at commit. DENIED -> APPROVED puts the booking back
     * on the calendar; a booking that raced into the slot after {@link #requireCanApprove} is caught
     * by the active-slot unique index (23505) or the PostgreSQL exclusion constraint (23P01), and is
     * reported as the same 409 the in-transaction check gives instead of a generic data conflict.
     */
    private void flushApproval() {
        try {
            appointmentRepository.flush();
        } catch (org.springframework.dao.DataIntegrityViolationException ex) {
            if (isSlotConstraintViolation(ex)) {
                throw new ConflictException("The selected slot is already booked or unavailable.");
            }
            throw ex;
        }
    }

    /** PENDING -> APPROVED|DENIED, APPROVED -> DENIED, DENIED -> APPROVED. */
    private static boolean isAllowedTransition(AppointmentStatus from, AppointmentStatus to) {
        return switch (from) {
            case PENDING -> to == AppointmentStatus.APPROVED || to == AppointmentStatus.DENIED;
            case APPROVED -> to == AppointmentStatus.DENIED;
            case DENIED -> to == AppointmentStatus.APPROVED;
            case CANCELLED -> false;
        };
    }

    /**
     * Re-validates a booking before it is (re-)approved. Every refusal is a 409: the request
     * is well-formed, but the booking's current state no longer allows it.
     */
    private void requireCanApprove(Appointment item) {
        Barber barber = item.getBarber();
        if (barber == null || NO_PREFERENCE_BARBER.equals(item.getBarberName())) {
            throw new ConflictException("This appointment has no assigned barber and cannot be approved. "
                    + "Deny or cancel it instead.");
        }
        LocalTime start = LocalTime.parse(item.getBookingTime());
        if (!LocalDateTime.of(item.getBookingDate(), start).isAfter(LocalDateTime.now(clock))) {
            throw new ConflictException("A past appointment cannot be approved.");
        }
        busySlotsService.findConflict(barber, item.getBookingDate(), start,
                        BusySlotsService.durationOf(item), item.getId())
                .ifPresent(message -> {
                    throw new ConflictException(message);
                });
    }

    /** Admin DELETE: soft-cancels (the row is kept as CANCELLED). Past bookings may be cancelled by an admin. */
    @Override
    @Transactional
    public void deleteAppointment(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        cancelAppointment(item, AppointmentCancelledEvent.CancelledBy.ADMIN, false);
    }

    /**
     * Soft-cancels an appointment: status becomes CANCELLED, the slot is released (the active-slot
     * index ignores CANCELLED), the idempotency key and any review stay on the row, and the
     * customer is notified through {@link AppointmentCancelledEvent}.
     *
     * <ul>
     *   <li>already CANCELLED: idempotent no-op (no second e-mail);</li>
     *   <li>DENIED: 400 - there is nothing to cancel;</li>
     *   <li>{@code enforceNotPast}: customers and guests cannot cancel a booking that has started.</li>
     * </ul>
     */
    private void cancelAppointment(Appointment item, AppointmentCancelledEvent.CancelledBy cancelledBy,
                                   boolean enforceNotPast) {
        AppointmentStatus current = item.getStatusEnum();
        if (current == AppointmentStatus.CANCELLED) {
            return;
        }
        if (current == AppointmentStatus.DENIED) {
            throw new IllegalArgumentException("A declined appointment cannot be cancelled.");
        }
        if (enforceNotPast && !startOf(item).isAfter(LocalDateTime.now(clock))) {
            throw new IllegalArgumentException(
                    "This appointment has already started or passed and can no longer be cancelled online.");
        }

        item.setStatus(AppointmentStatus.CANCELLED);
        Appointment saved = appointmentRepository.save(item);
        eventPublisher.publishEvent(new AppointmentCancelledEvent(AppointmentDetails.of(saved), cancelledBy));
        publishAvailabilityChange(
                AvailabilityChangedEvent.single(saved.getBarberName(), saved.getBookingDate()));
        publishAdminEvent(AppointmentAdminEvent.Type.UPDATED, saved.getId());

        tagSpan(
            "appointment.id", String.valueOf(saved.getId()),
            "appointment.action", "cancel",
            "appointment.cancelledBy", cancelledBy.name()
        );
    }

    private static LocalDateTime startOf(Appointment item) {
        return LocalDateTime.of(item.getBookingDate(), LocalTime.parse(item.getBookingTime()));
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<String> getBusySlots(String barberName, String bookingDate) {
        java.util.List<String> unbookable = busyOutsideBookingWindow(barberName, bookingDate);
        return unbookable != null ? unbookable : busySlotsService.getBusySlots(barberName, bookingDate);
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<String> getBusySlots(String barberName, String bookingDate, String serviceType) {
        java.util.List<String> unbookable = busyOutsideBookingWindow(barberName, bookingDate);
        if (unbookable != null) {
            return unbookable;
        }
        if (serviceType == null || serviceType.isBlank()) {
            return busySlotsService.getBusySlots(barberName, bookingDate);
        }
        ServiceItem service = catalogService.findServiceByName(serviceType.trim())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown service: '" + LogSanitizer.stripNewlines(serviceType)
                                + "'. Please select a service from the catalog."));
        int duration = service.getDurationMinutes() != null && service.getDurationMinutes() > 0
                ? service.getDurationMinutes() : BusySlotsService.DEFAULT_DURATION_MINUTES;
        // Services that fit in one grid step get the same answer from the cached path; only
        // longer ones need the length-aware computation (cached per duration).
        return duration > BusySlotsService.DEFAULT_DURATION_MINUTES
                ? busySlotsService.getBusySlots(barberName, bookingDate, duration)
                : busySlotsService.getBusySlots(barberName, bookingDate);
    }

    /**
     * Every slot of a date nobody can book (before today in shop time, or beyond
     * {@code max-advance-days}), or {@code null} for a bookable or malformed date (the latter is
     * reported by {@link BusySlotsService}). Answered without the per-date queries or a cache entry:
     * any date of the years 0001-9999 used to be computed and cached, and a past date reported every
     * slot as free. An unknown barber is still a 400.
     */
    private java.util.List<String> busyOutsideBookingWindow(String barberName, String bookingDate) {
        LocalDate date;
        try {
            date = LocalDate.parse(bookingDate == null ? "" : bookingDate.trim());
        } catch (java.time.format.DateTimeParseException e) {
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

    @Override
    @Transactional
    public void publicCancelAppointment(String publicId, String email) {
        Appointment item = appointmentRepository.findByPublicId(publicId);
        if (item == null) {
            throw new ResourceNotFoundException("Appointment booking not found.");
        }
        if (!item.getCustomerEmail().equalsIgnoreCase(email.trim())) {
            throw new IllegalArgumentException("Verification failed: The provided email address does not match this booking ID.");
        }
        cancelAppointment(item, AppointmentCancelledEvent.CancelledBy.GUEST, true);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AppointmentDetails> findDetailsByPublicId(String publicId) {
        return Optional.ofNullable(appointmentRepository.findByPublicId(publicId)).map(AppointmentDetails::of);
    }

    private void publishAdminEvent(AppointmentAdminEvent.Type type, Long appointmentId) {
        if (appointmentId != null) {
            eventPublisher.publishEvent(new AppointmentAdminEvent(type, appointmentId, Instant.now(clock)));
        }
    }

    /**
     * Signals that availability changed. The event is handled after the
     * transaction commits so a rollback never clears committed cache state and
     * a cache failure never rolls back a committed booking.
     */
    private void publishAvailabilityChange(AvailabilityChangedEvent event) {
        eventPublisher.publishEvent(event);
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<Long> findAppointmentIdsNeedingReminders(LocalDate tomorrow) {
        return appointmentRepository.findReminderIds(tomorrow, false, AppointmentStatus.APPROVED);
    }

    @Override
    @Transactional
    public Optional<AppointmentDetails> claimReminder(Long id, LocalDate tomorrow) {
        Appointment appointment = appointmentRepository.findByIdForUpdate(id).orElse(null);
        if (appointment == null || Boolean.TRUE.equals(appointment.getReminderSent())) {
            return Optional.empty();
        }
        // The id was selected before the lock was taken; the booking may have been denied,
        // cancelled or moved in between. Re-check under the lock and skip rather than remind a
        // customer about a booking that no longer exists.
        if (appointment.getStatusEnum() != AppointmentStatus.APPROVED
                || !tomorrow.equals(appointment.getBookingDate())) {
            logger.info("Skipping reminder for appointment id={}: status={} date={} no longer qualifies",
                    appointment.getId(), appointment.getStatus(), appointment.getBookingDate());
            return Optional.empty();
        }
        appointment.setReminderSent(true);
        appointmentRepository.save(appointment);
        return Optional.of(AppointmentDetails.of(appointment));
    }

    /**
     * H1: Walk the exception cause chain looking for a {@link java.sql.SQLException}
     * whose SQLState is {@code "23505"} (the SQL-standard code for unique violation
     * shared by PostgreSQL and H2) or {@code "23P01"} (PostgreSQL exclusion_violation,
     * raised by the {@code appointments_no_overlap} constraint from V35). Other integrity
     * violations (FK = 23503, NOT NULL = 23502, CHECK = 23514) will not match, allowing
     * the caller to distinguish a genuine slot/idempotency collision from other data issues.
     */
    static boolean isSlotConstraintViolation(Throwable ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof java.sql.SQLException sqlEx) {
                if ("23505".equals(sqlEx.getSQLState()) || "23P01".equals(sqlEx.getSQLState())) {
                    return true;
                }
            }
            cause = cause.getCause();
        }
        return false;
    }

}
