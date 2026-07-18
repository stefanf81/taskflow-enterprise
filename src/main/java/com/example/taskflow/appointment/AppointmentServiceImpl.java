package com.example.taskflow.appointment;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemRepository;
import com.example.taskflow.core.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.micrometer.tracing.Tracer;

import java.time.LocalDate;

@Service
@Transactional
public class AppointmentServiceImpl implements AppointmentService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentServiceImpl.class);
    private static final int MAX_BUSY_SLOTS = 500;

    private final AppointmentRepository appointmentRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final CacheManager cacheManager;
    private final Tracer tracer;
    private final BusySlotsService busySlotsService;
    private final BarberRepository barberRepository;
    private final ServiceItemRepository serviceItemRepository;

    public AppointmentServiceImpl(AppointmentRepository appointmentRepository,
                                  ApplicationEventPublisher eventPublisher,
                                  CacheManager cacheManager,
                                   Tracer tracer,
                                   BusySlotsService busySlotsService,
                                   BarberRepository barberRepository,
                                   ServiceItemRepository serviceItemRepository) {
        this.appointmentRepository = appointmentRepository;
        this.eventPublisher = eventPublisher;
        this.cacheManager = cacheManager;
        this.tracer = tracer;
        this.busySlotsService = busySlotsService;
        this.barberRepository = barberRepository;
        this.serviceItemRepository = serviceItemRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public AppointmentDashboardResponse getAllAppointments(String status, String searchName, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("bookingDate").ascending().and(Sort.by("bookingTime").ascending()));
        Page<Appointment> itemPage;

        if (status != null && !status.trim().isEmpty() && "OVERDUE".equalsIgnoreCase(status.trim())) {
            itemPage = appointmentRepository.findByStatusAndBookingDateBefore("PENDING", LocalDate.now(), pageable);
        } else if (status != null && !status.trim().isEmpty() && searchName != null && !searchName.trim().isEmpty()) {
            itemPage = appointmentRepository.findByStatusAndCustomerNameContainingIgnoreCase(status.trim(), searchName.trim(), pageable);
        } else if (status != null && !status.trim().isEmpty()) {
            itemPage = appointmentRepository.findByStatus(status.trim(), pageable);
        } else if (searchName != null && !searchName.trim().isEmpty()) {
            itemPage = appointmentRepository.findByCustomerNameContainingIgnoreCase(searchName.trim(), pageable);
        } else {
            itemPage = appointmentRepository.findAll(pageable);
        }

        Page<AppointmentResponse> responsePage = itemPage.map(AppointmentResponse::fromEntity);

        AppointmentStats stats = getAppointmentStatsCached();
        int progress = stats.total() > 0 ? (int) Math.round(((double) stats.approved() / stats.total()) * 100) : 0;
        
        AppointmentStats updatedStats = new AppointmentStats(
                stats.total(), stats.pending(), stats.approved(), stats.denied(), 
                stats.overdue(), progress, stats.approvedRevenue()
        );

        return new AppointmentDashboardResponse(responsePage, updatedStats);
    }

    public AppointmentStats getAppointmentStatsCached() {
        Cache cache = cacheManager.getCache("appointmentStats");
        if (cache != null) {
            return cache.get(LocalDate.now(), () -> appointmentRepository.getAppointmentStats(LocalDate.now()));
        }
        return appointmentRepository.getAppointmentStats(LocalDate.now());
    }

    private void clearAppointmentStatsCache() {
        Cache cache = cacheManager.getCache("appointmentStats");
        if (cache != null) {
            // Evict only the current day's stats to prevent cache stampede
            // (clear() would wipe all cached days and cause a thundering herd on the next read)
            cache.evict(LocalDate.now());
        }
    }

    private void clearBusySlotsCache(String barberName, LocalDate bookingDate) {
        Cache cache = cacheManager.getCache("busySlots");
        if (cache != null) {
            cache.evict(barberName + "-" + bookingDate);
        }
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
    public void cancelMyAppointment(Long id, String email) {
        Appointment appointment = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found or unauthorized."));
        if (!appointment.getCustomerEmail().equalsIgnoreCase(email)) {
            throw new ResourceNotFoundException("Appointment not found or unauthorized.");
        }
        deleteAppointment(id);
    }

    @Override
    public AppointmentResponse createAppointment(AppointmentCreateRequest request, String idempotencyKey) {
        if (idempotencyKey != null && !idempotencyKey.trim().isEmpty()) {
            Appointment existing = appointmentRepository.findByIdempotencyKey(idempotencyKey);
            if (existing != null) {
                logger.info("Idempotency key {} already exists. Returning existing appointment.", idempotencyKey.replaceAll("[\\r\\n]", ""));
                return AppointmentResponse.fromEntity(existing);
            }
        }

        // Validate slot availability (prevent double-bookings and off-hour bookings)
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
            clearAppointmentStatsCache();
            clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());

            try {
                io.micrometer.tracing.Span currentSpan = tracer.currentSpan();
                if (currentSpan != null) {
                    currentSpan.tag("appointment.id", String.valueOf(savedItem.getId()));
                    currentSpan.tag("appointment.customer", savedItem.getCustomerName());
                    currentSpan.tag("appointment.status", savedItem.getStatus());
                }
            } catch (Exception e) {
                String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
                logger.warn("Failed to add tracing tags: {}", safeMsg);
            }

            return AppointmentResponse.fromEntity(savedItem);
        } catch (org.springframework.dao.DataIntegrityViolationException ex) {
            Appointment existing = appointmentRepository.findByIdempotencyKey(idempotencyKey);
            if (existing != null) {
                logger.info("Concurrent duplicate for idempotency key {}. Returning existing appointment.",
                        idempotencyKey != null ? idempotencyKey.replaceAll("[\\r\\n]", "") : "<null>");
                return AppointmentResponse.fromEntity(existing);
            }
            throw ex;
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
    public AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));

        item.setStatus(request.status().toUpperCase());
        Appointment savedItem = appointmentRepository.save(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(savedItem.getBarberName(), savedItem.getBookingDate());

        try {
            io.micrometer.tracing.Span currentSpan = tracer.currentSpan();
            if (currentSpan != null) {
                currentSpan.tag("appointment.id", String.valueOf(savedItem.getId()));
                currentSpan.tag("appointment.status", savedItem.getStatus());
            }
        } catch (Exception e) {
            String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
            logger.warn("Failed to add tracing tags: {}", safeMsg);
        }

        // Publish the status-change event. The notification outbox entry is written
        // by the (separate) notification slice listener so the appointment slice
        // stays decoupled from the notification slice (ArchUnit cycle rule).
        eventPublisher.publishEvent(new AppointmentStatusChangedEvent(this, savedItem));

        return AppointmentResponse.fromEntity(savedItem);
    }

    @Override
    public void deleteAppointment(Long id) {
        Appointment item = appointmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Appointment not found with id: " + id));
        appointmentRepository.delete(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(item.getBarberName(), item.getBookingDate());

        try {
            io.micrometer.tracing.Span currentSpan = tracer.currentSpan();
            if (currentSpan != null) {
                currentSpan.tag("appointment.id", String.valueOf(id));
                currentSpan.tag("appointment.action", "delete");
            }
        } catch (Exception e) {
            String safeMsg = e.getMessage() != null ? e.getMessage().replaceAll("[\\r\\n]", "") : "";
            logger.warn("Failed to add tracing tags: {}", safeMsg);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<String> getBusySlots(String barberName, String bookingDate) {
        return busySlotsService.getBusySlots(barberName, bookingDate);
    }

    @Override
    public void publicCancelAppointment(String publicId, String email) {
        Appointment item = appointmentRepository.findByPublicId(publicId);
        if (item == null) {
            throw new ResourceNotFoundException("Appointment booking not found.");
        }
        if (!item.getCustomerEmail().equalsIgnoreCase(email.trim())) {
            throw new IllegalArgumentException("Verification failed: The provided email address does not match this booking ID.");
        }
        appointmentRepository.delete(item);
        clearAppointmentStatsCache();
        clearBusySlotsCache(item.getBarberName(), item.getBookingDate());
    }

    @Override
    public Appointment findByPublicId(String publicId) {
        return appointmentRepository.findByPublicId(publicId);
    }

}
