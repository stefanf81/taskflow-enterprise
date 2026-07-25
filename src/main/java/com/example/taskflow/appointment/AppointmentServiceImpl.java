package com.example.taskflow.appointment;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemRepository;
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

@Service
public class AppointmentServiceImpl implements AppointmentService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentServiceImpl.class);
    private static final int MAX_BUSY_SLOTS = 500;

    private final AppointmentRepository appointmentRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final AppointmentStatsService statsService;
    private final Tracer tracer;
    private final BusySlotsService busySlotsService;
    private final BarberRepository barberRepository;
    private final BarberScheduleRepository barberScheduleRepository;
    private final ServiceItemRepository serviceItemRepository;

    public AppointmentServiceImpl(AppointmentRepository appointmentRepository,
                                  ApplicationEventPublisher eventPublisher,
                                  AppointmentStatsService statsService,
                                   Tracer tracer,
                                   BusySlotsService busySlotsService,
                                   BarberRepository barberRepository,
                                   BarberScheduleRepository barberScheduleRepository,
                                   ServiceItemRepository serviceItemRepository) {
        this.appointmentRepository = appointmentRepository;
        this.eventPublisher = eventPublisher;
        this.statsService = statsService;
        this.tracer = tracer;
        this.busySlotsService = busySlotsService;
        this.barberRepository = barberRepository;
        this.barberScheduleRepository = barberScheduleRepository;
        this.serviceItemRepository = serviceItemRepository;
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
    public AppointmentResponse createAppointment(AppointmentCreateRequest request, String idempotencyKey) {
        if (idempotencyKey != null && !idempotencyKey.trim().isEmpty()) {
            Appointment existing = appointmentRepository.findByIdempotencyKey(idempotencyKey);
            if (existing != null) {
                logger.info("Idempotency key {} already exists. Returning existing appointment.", LogSanitizer.stripNewlines(idempotencyKey));
                return AppointmentResponse.fromEntity(existing);
            }
        }

        // A2: enforce that the requested time falls within the barber's scheduled
        // working window for that day of week (returns a clear 400 rather than
        // relying on the busy-slot side effect). Backed by BarberSchedule.
        validateBookingTimeWithinSchedule(request.barberName(), request.bookingDate(), request.bookingTime());

        // Validate slot availability (prevent double-bookings)
        // Call via injected BusySlotsService so the @Cacheable proxy is actually used.
        java.util.List<String> busy = busySlotsService.getBusySlots(request.barberName(), request.bookingDate().toString());
        if (busy.contains(request.bookingTime())) {
            throw new IllegalArgumentException("The selected slot is already booked or unavailable.");
        }

        Appointment item = new Appointment();
        item.setIdempotencyKey(idempotencyKey);
        item.setCustomerName(request.customerName());
        item.setCustomerEmail(request.customerEmail());
        item.setCustomerPhone(request.customerPhone());
        // A1: keep denormalized name cache in sync with the FK (renders instantly
        // in the UI without an extra join) AND resolve the real catalog FKs.
        item.setBarberName(request.barberName());
        item.setServiceType(request.serviceType());
        resolveAndSetCatalogReferences(item, request.barberName(), request.serviceType());
        item.setBookingDate(request.bookingDate());
        item.setBookingTime(request.bookingTime());
        item.setStatus("PENDING");

        // A4: idempotency is enforced by a unique constraint on idempotency_key.
        // The check-then-save above is non-atomic, so concurrent duplicates can
        // race past the check. Catch the constraint violation and return the
        // already-persisted row instead of surfacing a 500.
        try {
            Appointment savedItem = appointmentRepository.save(item);
            statsService.clearStatsCache();
            statsService.clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());

            tagSpan(
                "appointment.id", String.valueOf(savedItem.getId()),
                "appointment.customer", savedItem.getCustomerName(),
                "appointment.status", savedItem.getStatus()
            );

            return AppointmentResponse.fromEntity(savedItem);
        } catch (org.springframework.dao.DataIntegrityViolationException ex) {
            // Idempotency-key collision: return the already-persisted row.
            Appointment existing = appointmentRepository.findByIdempotencyKey(idempotencyKey);
            if (existing != null) {
                logger.info("Concurrent duplicate for idempotency key {}. Returning existing appointment.",
                        LogSanitizer.stripNewlines(idempotencyKey));
                return AppointmentResponse.fromEntity(existing);
            }
            // Slot was booked between our busy-slots check and save (TOCTOU).
            // The partial unique index idx_appointment_slot_active caught it.
            // Return a clear 400 message instead of a 500 constraint-violation error.
            logger.warn("Slot collision for {} at {} on {} — request raced with another booking.",
                    LogSanitizer.stripNewlines(request.barberName()),
                    request.bookingTime(),
                    request.bookingDate());
            throw new IllegalArgumentException(
                    "This time slot was just booked by someone else. Please select a different time.");
        }
    }

    /**
     * A2: confirm the requested {@code bookingTime} is inside the barber's
     * {@link BarberSchedule} window for the weekday of {@code bookingDate}.
     * Throws {@link IllegalArgumentException} (→ 400) when the barber is not
     * scheduled that day or the time is outside working hours.
     */
    private void validateBookingTimeWithinSchedule(String barberName, LocalDate bookingDate, String bookingTime) {
        Barber barber = barberRepository.findByName(barberName).orElse(null);
        if (barber == null) {
            // Barber unknown: the booking still proceeds with the denormalized name,
            // but we cannot validate the window — let the busy-slot check handle it.
            return;
        }
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
     * associations for relational integrity and correct stats joins. A missing
     * catalog entry (e.g. a typo'd barber) leaves the FK null but keeps the
     * denormalized string so the booking is never lost.
     */
    private void resolveAndSetCatalogReferences(Appointment item, String barberName, String serviceType) {
        barberRepository.findByName(barberName).ifPresent(item::setBarber);
        serviceItemRepository.findByName(serviceType).ifPresent(item::setService);
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

        tagSpan(
            "appointment.publicId", LogSanitizer.stripNewlines(publicId),
            "appointment.action", "publicCancel"
        );
    }

    @Override
    public Appointment findByPublicId(String publicId) {
        return appointmentRepository.findByPublicId(publicId);
    }

}
