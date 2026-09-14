package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.IdempotencyConflictException;
import com.example.taskflow.core.LogSanitizer;
import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import io.micrometer.tracing.Tracer;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.Instant;

@Service
public class AppointmentServiceImpl implements AppointmentService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentServiceImpl.class);
    private static final int MAX_BUSY_SLOTS = 500;

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
    private final BarberScheduleRepository barberScheduleRepository;
    private final BarberTimeOffRepository barberTimeOffRepository;
    private final CatalogService catalogService;

    public AppointmentServiceImpl(AppointmentRepository appointmentRepository,
                                  ApplicationEventPublisher eventPublisher,
                                  AppointmentStatsService statsService,
                                   Tracer tracer,
                                   BusySlotsService busySlotsService,
                                   BarberRepository barberRepository,
                                   BarberScheduleRepository barberScheduleRepository,
                                   BarberTimeOffRepository barberTimeOffRepository,
                                   CatalogService catalogService) {
        this.appointmentRepository = appointmentRepository;
        this.eventPublisher = eventPublisher;
        this.statsService = statsService;
        this.tracer = tracer;
        this.busySlotsService = busySlotsService;
        this.barberRepository = barberRepository;
        this.barberScheduleRepository = barberScheduleRepository;
        this.barberTimeOffRepository = barberTimeOffRepository;
        this.catalogService = catalogService;
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
        Page<Appointment> itemPage;

        if (status != null && !status.trim().isEmpty() && "OVERDUE".equalsIgnoreCase(status.trim())) {
            itemPage = appointmentRepository.findByStatusAndBookingDateBefore(AppointmentStatus.PENDING, LocalDate.now(), pageable);
        } else if (status != null && !status.trim().isEmpty() && searchName != null && !searchName.trim().isEmpty()) {
            itemPage = appointmentRepository.findByStatusAndCustomerNameContainingIgnoreCase(AppointmentStatus.fromString(status.trim()), searchName.trim(), pageable);
        } else if (status != null && !status.trim().isEmpty()) {
            itemPage = appointmentRepository.findByStatus(AppointmentStatus.fromString(status.trim()), pageable);
        } else if (searchName != null && !searchName.trim().isEmpty()) {
            itemPage = appointmentRepository.findByCustomerNameContainingIgnoreCase(searchName.trim(), pageable);
        } else {
            itemPage = appointmentRepository.findAll(pageable);
        }

        Page<AppointmentResponse> responsePage = itemPage.map(AppointmentResponse::fromEntity);

        AppointmentStats stats = statsService.getStatsCached(appointmentRepository);
        return new AppointmentDashboardResponse(responsePage, stats);
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
        deleteAppointment(appointment.getId());
    }

    @Override
    @Transactional
    public AppointmentCreationResult createAppointment(AppointmentCreateRequest request, String idempotencyKey) {
        String trimmedKey = idempotencyKey == null ? null : idempotencyKey.trim();
        if (trimmedKey != null && !trimmedKey.isEmpty()) {
            Appointment existing = appointmentRepository.findByIdempotencyKey(trimmedKey);
            if (existing != null) {
                return replayOrConflict(existing, request, trimmedKey);
            }
        }

        // H2: "No Preference (First Available)" is an input-only sentinel. Resolve
        // it to a concrete, available barber BEFORE persisting so the partial
        // unique slot index and the per-barber availability queries both see the
        // booking. Persisting the sentinel verbatim let a real barber be booked at
        // the same slot because the sentinel looked like a distinct fictitious
        // barber to the unique index.
        Barber resolvedBarber = resolveBarber(request);
        String effectiveBarberName = resolvedBarber.getName();

        // A2: enforce that the requested time falls within the barber's scheduled
        // working window for that day of week (returns a clear 400 rather than
        // relying on the busy-slot side effect). Backed by BarberSchedule.
        validateBookingTimeWithinSchedule(resolvedBarber, request.bookingDate(), request.bookingTime());

        // Atomic (in-transaction) time-off recheck. The busy-slot lookup below is
        // cached for up to 2 minutes, so an admin time-off insertion between the
        // cache load and this save would otherwise let a booking slip through.
        // This fresh DB read closes that window for the common case. (A truly
        // concurrent insert racing this transaction remains a documented residual
        // race best closed by a database exclusion constraint if/when needed.)
        if (!barberTimeOffRepository.findTimeOffForBarberOnDate(resolvedBarber.getId(), request.bookingDate()).isEmpty()) {
            throw new IllegalArgumentException(
                    "The selected barber is unavailable on this date (time off). Please choose another date or barber.");
        }

        // Validate slot availability (prevent double-bookings)
        // Call via injected BusySlotsService so the @Cacheable proxy is actually used.
        java.util.List<String> busy = busySlotsService.getBusySlots(effectiveBarberName, request.bookingDate().toString());
        if (busy.contains(request.bookingTime())) {
            throw new IllegalArgumentException("The selected slot is already booked or unavailable.");
        }

        Appointment item = new Appointment();
        item.setIdempotencyKey(trimmedKey);
        item.setCustomerName(request.customerName());
        item.setCustomerEmail(request.customerEmail());
        item.setCustomerPhone(request.customerPhone());
        // A1: keep denormalized name cache in sync with the FK (renders instantly
        // in the UI without an extra join) AND resolve the real catalog FKs.
        item.setBarberName(effectiveBarberName);
        item.setServiceType(request.serviceType());
        resolveAndSetCatalogReferences(item, resolvedBarber, request.serviceType());
        item.setBookingDate(request.bookingDate());
        item.setBookingTime(request.bookingTime());
        item.setStatus("PENDING");

        // A4: idempotency is enforced by a unique constraint on idempotency_key.
        // The check-then-save above is non-atomic, so concurrent duplicates can
        // race past the check. Catch the constraint violation and resolve it to
        // either a verified replay, an idempotency conflict, or a slot collision.
        try {
            Appointment savedItem = appointmentRepository.save(item);
            statsService.clearStatsCache();
            statsService.clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());
            publishAdminEvent(AppointmentAdminEvent.Type.CREATED, savedItem.getId());

            tagSpan(
                "appointment.id", String.valueOf(savedItem.getId()),
                "appointment.customer", savedItem.getCustomerName(),
                "appointment.status", savedItem.getStatus()
            );

            return AppointmentCreationResult.created(AppointmentResponse.fromEntity(savedItem));
        } catch (org.springframework.dao.DataIntegrityViolationException ex) {
            // H1: Inspect the root cause to distinguish constraint violations.
            // Previously, ANY DataIntegrityViolationException was treated as either
            // an idempotency-key collision or a slot collision. A different constraint
            // (FK, NOT NULL, CHECK) would incorrectly return "slot was just booked".
            //
            // Next steps:
            //   1. Try idempotency-key lookup — verified replay or 409 conflict.
            //   2. If SQLState = 23505 (unique_violation), treat as slot collision.
            //   3. Otherwise, surface a generic "data conflict" error.
            if (trimmedKey != null && !trimmedKey.isEmpty()) {
                Appointment existing = appointmentRepository.findByIdempotencyKey(trimmedKey);
                if (existing != null) {
                    return replayOrConflict(existing, request, trimmedKey);
                }
            }
            if (isUniqueViolation(ex)) {
                // Slot was booked between our busy-slots check and save (TOCTOU).
                // The partial unique index idx_appointment_slot_active caught it.
                logger.warn("Slot collision for {} at {} on {} — request raced with another booking.",
                        LogSanitizer.stripNewlines(effectiveBarberName),
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
        }
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
     * is scheduled and free for the requested slot; unknown concrete names are
     * rejected with a 400.
     */
    private Barber resolveBarber(AppointmentCreateRequest request) {
        if (NO_PREFERENCE_BARBER.equals(request.barberName())) {
            return busySlotsService.findFirstAvailableBarber(request.bookingDate(), request.bookingTime())
                    .orElseThrow(() -> new IllegalArgumentException(
                            "No barber is available for the selected time. Please choose another time or barber."));
        }
        return barberRepository.findByName(request.barberName())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown barber: '" + LogSanitizer.stripNewlines(request.barberName())
                                + "'. Please select a barber from the list."));
    }

    /**
     * A2: confirm the requested {@code bookingTime} is inside the barber's
     * {@link BarberSchedule} window for the weekday of {@code bookingDate}.
     * Throws {@link IllegalArgumentException} (→ 400) when the barber is not
     * scheduled that day or the time is outside working hours.
     */
    private void validateBookingTimeWithinSchedule(Barber barber, LocalDate bookingDate, String bookingTime) {
        BarberSchedule schedule = barberScheduleRepository
                .findByBarberIdAndDayOfWeek(barber.getId(), bookingDate.getDayOfWeek().getValue())
                .orElseThrow(() -> new IllegalArgumentException("The selected barber is not scheduled to work on the requested date."));

        LocalTime requested = LocalTime.parse(bookingTime);
        if (requested.isBefore(schedule.getStartTime()) || !requested.isBefore(schedule.getEndTime())) {
            throw new IllegalArgumentException(
                    "Booking time must be within the barber's working hours (" +
                            schedule.getStartTime() + "–" + schedule.getEndTime() + ").");
        }
    }

    /**
     * A1: resolve the catalog FKs from the free-text names submitted by the
     * booking form. The denormalized name columns are already set by the caller;
     * this additionally wires the real {@code barber} / {@code service}
     * associations for relational integrity and correct stats joins.
     *
     * <p>Unknown service names are rejected with a 400.
     */
    private void resolveAndSetCatalogReferences(Appointment item, Barber barber, String serviceType) {
        item.setBarber(barber);
        ServiceItem service = catalogService.findServiceByName(serviceType)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown service: '" + LogSanitizer.stripNewlines(serviceType)
                                + "'. Please select a service from the catalog."));
        item.setService(service);
    }

    @Override
    @Transactional
    public AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));

        item.setStatus(request.status().toUpperCase());
        Appointment savedItem = appointmentRepository.save(item);
        statsService.clearStatsCache();
        statsService.clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());

        tagSpan(
            "appointment.id", String.valueOf(savedItem.getId()),
            "appointment.status", savedItem.getStatus()
        );

        // Publish the status-change event. The notification outbox entry is written
        // by the (separate) notification slice listener so the appointment slice
        // stays decoupled from the notification slice (ArchUnit cycle rule).
        eventPublisher.publishEvent(new AppointmentStatusChangedEvent(this, savedItem));
        publishAdminEvent(AppointmentAdminEvent.Type.UPDATED, savedItem.getId());

        return AppointmentResponse.fromEntity(savedItem);
    }

    @Override
    @Transactional
    public void deleteAppointment(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        appointmentRepository.delete(item);
        statsService.clearStatsCache();
        statsService.clearBusySlotsCache(item.getBarberName(), item.getBookingDate());
        publishAdminEvent(AppointmentAdminEvent.Type.DELETED, item.getId());

        tagSpan(
            "appointment.id", String.valueOf(id),
            "appointment.action", "delete"
        );
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<String> getBusySlots(String barberName, String bookingDate) {
        return busySlotsService.getBusySlots(barberName, bookingDate);
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
        // Publish event BEFORE deletion so listeners can read the entity fields.
        // This ensures notification outbox entries are written for the cancellation.
        eventPublisher.publishEvent(new AppointmentStatusChangedEvent(this, item));
        appointmentRepository.delete(item);
        statsService.clearStatsCache();
        statsService.clearBusySlotsCache(item.getBarberName(), item.getBookingDate());
        publishAdminEvent(AppointmentAdminEvent.Type.DELETED, item.getId());

        tagSpan(
            "appointment.publicId", LogSanitizer.stripNewlines(publicId),
            "appointment.action", "publicCancel"
        );
    }

    @Override
    public Appointment findByPublicId(String publicId) {
        return appointmentRepository.findByPublicId(publicId);
    }

    private void publishAdminEvent(AppointmentAdminEvent.Type type, Long appointmentId) {
        if (appointmentId != null) {
            eventPublisher.publishEvent(new AppointmentAdminEvent(type, appointmentId, Instant.now()));
        }
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<Long> findAppointmentIdsNeedingReminders(LocalDate tomorrow) {
        return appointmentRepository.findReminderIds(tomorrow, false, AppointmentStatus.APPROVED);
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.Optional<Appointment> lockForReminder(Long id) {
        return appointmentRepository.findByIdForUpdate(id);
    }

    @Override
    @Transactional
    public void save(Appointment appointment) {
        appointmentRepository.save(appointment);
    }

    /**
     * H1: Walk the exception cause chain looking for a {@link java.sql.SQLException}
     * whose SQLState is {@code "23505"} (the SQL-standard code for unique violation
     * shared by PostgreSQL and H2). Non-unique integrity violations (FK = 23503,
     * NOT NULL = 23502, CHECK = 23514) will not match, allowing the caller to
     * distinguish a genuine slot/idempotency collision from other data issues.
     */
    private static boolean isUniqueViolation(Throwable ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof java.sql.SQLException sqlEx) {
                if ("23505".equals(sqlEx.getSQLState())) {
                    return true;
                }
            }
            cause = cause.getCause();
        }
        return false;
    }

}
